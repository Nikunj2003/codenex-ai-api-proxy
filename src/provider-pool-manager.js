import * as fs from 'fs'; // Import fs module
import { getServiceAdapter } from './adapter.js';
import { MODEL_PROVIDER, getProtocolPrefix } from './common.js';
import { getProviderModels } from './provider-models.js';
import axios from 'axios';
import { metricsService } from './metrics-service.js';

/**
 * Manages a pool of API service providers, handling their health and selection.
 */
export class ProviderPoolManager {
    // Default health check model configuration
    // Key names must match MODEL_PROVIDER constant values
    static DEFAULT_HEALTH_CHECK_MODELS = {
        'gemini-cli-oauth': 'gemini-2.5-flash',
        'gemini-antigravity': 'gemini-2.5-flash',
        'openai-custom': 'gpt-3.5-turbo',
        'claude-custom': 'claude-3-7-sonnet-20250219',
        'openaiResponses-custom': 'gpt-4o-mini',
        'claudeCode-custom': 'haiku'
    };

    constructor(providerPools, options = {}) {
        this.providerPools = providerPools;
        this.globalConfig = options.globalConfig || {}; // Store global config
        this.providerStatus = {}; // Track health and usage for each provider instance
        this.roundRobinIndex = {}; // Track round-robin index for each provider type
        // Use ?? operator to ensure 0 can be set correctly, instead of being replaced by default value with ||
        this.maxErrorCount = options.maxErrorCount ?? 3; // Default to 3 errors before marking unhealthy
        this.healthCheckInterval = options.healthCheckInterval ?? 10 * 60 * 1000; // Default to 10 minutes

        // Log level control
        this.logLevel = options.logLevel || 'info'; // 'debug', 'info', 'warn', 'error'

        // Debounce mechanism to avoid frequent file I/O operations
        this.saveDebounceTime = options.saveDebounceTime || 1000; // Default 1 second debounce
        this.saveTimer = null;
        this.pendingSaves = new Set(); // Track pending providerTypes to save

        // Fallback chain config
        this.fallbackChain = options.globalConfig?.providerFallbackChain || {};

        // Auto health check configuration
        this.healthCheckTimers = {}; // Map of uuid -> setTimeout timer ID
        this.quickRetryIntervalMs = options.quickRetryIntervalMs ?? 10 * 1000; // 10 seconds between quick retries
        this.quickRetryMaxCount = options.quickRetryMaxCount ?? 3; // Maximum 3 quick retry attempts
        this.rateLimitHealthCheckIntervalMs = options.rateLimitHealthCheckIntervalMs ?? 3 * 60 * 60 * 1000; // 3 hours for 429 errors
        this.standardHealthCheckIntervalMs = options.standardHealthCheckIntervalMs ?? 3 * 60 * 60 * 1000; // 3 hours fallback
        this.autoHealthCheckEnabled = options.autoHealthCheckEnabled ?? true; // Enable/disable auto health checks

        this.initializeProviderStatus();
    }

    /**
     * Log output method with log level control
     * @private
     */
    _log(level, message) {
        const levels = { debug: 0, info: 1, warn: 2, error: 3 };
        if (levels[level] >= levels[this.logLevel]) {
            const logMethod = level === 'debug' ? 'log' : level;
            console[logMethod](`[ProviderPoolManager] ${message}`);
        }
    }

    /**
     * Find specified provider
     * @private
     */
    _findProvider(providerType, uuid) {
        if (!providerType || !uuid) {
            this._log('error', `Invalid parameters: providerType=${providerType}, uuid=${uuid}`);
            return null;
        }
        const pool = this.providerStatus[providerType];
        return pool?.find(p => p.uuid === uuid) || null;
    }

    /**
     * Initializes the status for each provider in the pools.
     * Initially, all providers are considered healthy and have zero usage.
     */
    initializeProviderStatus() {
        for (const providerType in this.providerPools) {
            this.providerStatus[providerType] = [];
            this.roundRobinIndex[providerType] = 0; // Initialize round-robin index for each type
            this.providerPools[providerType].forEach((providerConfig) => {
                // Ensure initial health and usage stats are present in the config
                providerConfig.isHealthy = providerConfig.isHealthy !== undefined ? providerConfig.isHealthy : true;
                providerConfig.isDisabled = providerConfig.isDisabled !== undefined ? providerConfig.isDisabled : false;
                providerConfig.lastUsed = providerConfig.lastUsed !== undefined ? providerConfig.lastUsed : null;
                providerConfig.usageCount = providerConfig.usageCount !== undefined ? providerConfig.usageCount : 0;
                providerConfig.errorCount = providerConfig.errorCount !== undefined ? providerConfig.errorCount : 0;
                
                // Optimization 2: Simplify lastErrorTime handling logic
                providerConfig.lastErrorTime = providerConfig.lastErrorTime instanceof Date
                    ? providerConfig.lastErrorTime.toISOString()
                    : (providerConfig.lastErrorTime || null);
                
                // Health check related fields
                providerConfig.lastHealthCheckTime = providerConfig.lastHealthCheckTime || null;
                providerConfig.lastHealthCheckModel = providerConfig.lastHealthCheckModel || null;
                providerConfig.lastErrorMessage = providerConfig.lastErrorMessage || null;

                // Auto health check state fields
                providerConfig.lastErrorStatusCode = providerConfig.lastErrorStatusCode ?? null; // HTTP status code (429, 400, 500, etc.)
                providerConfig.quickRetryCount = providerConfig.quickRetryCount ?? 0; // Count of quick retries (0-3)
                providerConfig.quickRetryPhaseStartTime = providerConfig.quickRetryPhaseStartTime || null; // When quick retry phase started
                providerConfig.lastQuickRetryTime = providerConfig.lastQuickRetryTime || null; // When last quick retry was performed
                providerConfig.healthCheckScheduleType = providerConfig.healthCheckScheduleType || null; // 'quick_retry' | 'rate_limit' | 'standard' | null

                this.providerStatus[providerType].push({
                    config: providerConfig,
                    uuid: providerConfig.uuid, // Still keep uuid at the top level for easy access
                });
            });
        }
        this._log('info', `Initialized provider statuses: ok (maxErrorCount: ${this.maxErrorCount})`);
    }

    /**
     * Selects a provider from the pool for a given provider type.
     * Currently uses a simple round-robin for healthy providers.
     * If requestedModel is provided, providers that don't support the model will be excluded.
     * @param {string} providerType - The type of provider to select (e.g., 'gemini-cli', 'openai-custom').
     * @param {string} [requestedModel] - Optional. The model name to filter providers by.
     * @returns {object|null} The selected provider's configuration, or null if no healthy provider is found.
     */
    selectProvider(providerType, requestedModel = null, options = {}) {
        // Parameter validation
        if (!providerType || typeof providerType !== 'string') {
            this._log('error', `Invalid providerType: ${providerType}`);
            return null;
        }

        const availableProviders = this.providerStatus[providerType] || [];
        let availableAndHealthyProviders = availableProviders.filter(p =>
            p.config.isHealthy && !p.config.isDisabled
        );

        // Filter out already-tried providers (for retry logic)
        const excludeUuids = options.excludeUuids;
        if (excludeUuids && excludeUuids.size > 0) {
            availableAndHealthyProviders = availableAndHealthyProviders.filter(
                p => !excludeUuids.has(p.config.uuid)
            );
            this._log('debug', `Excluded ${excludeUuids.size} already-tried providers, ${availableAndHealthyProviders.length} remaining`);
        }

        // If model is specified, exclude providers that don't support the model
        if (requestedModel) {
            const modelFilteredProviders = availableAndHealthyProviders.filter(p => {
                // If provider has no notSupportedModels configured, assume it supports all models
                if (!p.config.notSupportedModels || !Array.isArray(p.config.notSupportedModels)) {
                    return true;
                }
                // Check if notSupportedModels array contains the requested model, exclude if it does
                return !p.config.notSupportedModels.includes(requestedModel);
            });

            if (modelFilteredProviders.length === 0) {
                this._log('warn', `No available providers for type: ${providerType} that support model: ${requestedModel}`);
                return null;
            }

            availableAndHealthyProviders = modelFilteredProviders;
            this._log('debug', `Filtered ${modelFilteredProviders.length} providers supporting model: ${requestedModel}`);
        }

        if (availableAndHealthyProviders.length === 0) {
            this._log('warn', `No available and healthy providers for type: ${providerType}`);
            return null;
        }

        // Improvement: Use "Least Recently Used" (LRU) strategy instead of modulo round-robin
        // This ensures each account is evenly selected even when available list length changes dynamically
        const selected = availableAndHealthyProviders.sort((a, b) => {
            const timeA = a.config.lastUsed ? new Date(a.config.lastUsed).getTime() : 0;
            const timeB = b.config.lastUsed ? new Date(b.config.lastUsed).getTime() : 0;
            // Prioritize never used, or least recently used
            if (timeA !== timeB) return timeA - timeB;
            // If times are equal, use usage count as secondary criterion
            return (a.config.usageCount || 0) - (b.config.usageCount || 0);
        })[0];
        
        // Update usage info (unless explicitly skipped)
        if (!options.skipUsageCount) {
            selected.config.lastUsed = new Date().toISOString();
            selected.config.usageCount++;
            // Use debounced save
            this._debouncedSave(providerType);
        }

        this._log('debug', `Selected provider for ${providerType} (round-robin): ${selected.config.uuid}${requestedModel ? ` for model: ${requestedModel}` : ''}${options.skipUsageCount ? ' (skip usage count)' : ''}`);
        
        return selected.config;
    }

    /**
     * Selects a provider from the pool with fallback support.
     * When the primary provider type has no healthy providers, it will try fallback types.
     * @param {string} providerType - The primary type of provider to select.
     * @param {string} [requestedModel] - Optional. The model name to filter providers by.
     * @param {Object} [options] - Optional. Additional options.
     * @param {boolean} [options.skipUsageCount] - Optional. If true, skip incrementing usage count.
     * @returns {object|null} An object containing the selected provider's configuration and the actual provider type used, or null if no healthy provider is found.
     */
    selectProviderWithFallback(providerType, requestedModel = null, options = {}) {
        // Parameter validation
        if (!providerType || typeof providerType !== 'string') {
            this._log('error', `Invalid providerType: ${providerType}`);
            return null;
        }

        // Track tried types to avoid loops
        const triedTypes = new Set();
        const typesToTry = [providerType];
        
        // Add fallback types to try list
        const fallbackTypes = this.fallbackChain[providerType];
        if (!fallbackTypes || fallbackTypes.length === 0) {
            this._log('info', `No fallback types configured for ${providerType}`);
            const selectedConfig = this.selectProvider(providerType, requestedModel, options);
            if (selectedConfig) {
                return {
                    config: selectedConfig,
                    actualProviderType: providerType,
                    isFallback: false
                };
            }
        }

        if (Array.isArray(fallbackTypes)) {
            typesToTry.push(...fallbackTypes);
        }
        for (const currentType of typesToTry) {
            // Avoid duplicate attempts
            if (triedTypes.has(currentType)) {
                continue;
            }
            triedTypes.add(currentType);

            // Check if this type has a configured pool
            if (!this.providerStatus[currentType] || this.providerStatus[currentType].length === 0) {
                this._log('info', `No provider pool configured for type: ${currentType}`);
                continue;
            }

            // If this is a fallback type, check model compatibility
            if (currentType !== providerType && requestedModel) {
                // Check if protocol prefix is compatible
                const primaryProtocol = getProtocolPrefix(providerType);
                const fallbackProtocol = getProtocolPrefix(currentType);
                
                if (primaryProtocol !== fallbackProtocol) {
                    this._log('info', `Skipping fallback type ${currentType}: protocol mismatch (${primaryProtocol} vs ${fallbackProtocol})`);
                    continue;
                }

                // Check if fallback type supports the requested model
                const supportedModels = getProviderModels(currentType);
                if (supportedModels.length > 0 && !supportedModels.includes(requestedModel)) {
                    this._log('info', `Skipping fallback type ${currentType}: model ${requestedModel} not supported`);
                    continue;
                }
            }

            // Try to select provider from current type
            const selectedConfig = this.selectProvider(currentType, requestedModel, options);
            
            if (selectedConfig) {
                if (currentType !== providerType) {
                    this._log('info', `Fallback activated: ${providerType} -> ${currentType} (uuid: ${selectedConfig.uuid})`);
                }
                return {
                    config: selectedConfig,
                    actualProviderType: currentType,
                    isFallback: currentType !== providerType
                };
            }
        }

        this._log('warn', `None available provider found for ${providerType} or any of its fallback types: ${fallbackTypes?.join(', ') || 'none configured'}`);
        return null;
    }

    /**
     * Gets the fallback chain for a given provider type.
     * @param {string} providerType - The provider type to get fallback chain for.
     * @returns {Array<string>} The fallback chain array, or empty array if not configured.
     */
    getFallbackChain(providerType) {
        return this.fallbackChain[providerType] || [];
    }

    /**
     * Sets or updates the fallback chain for a provider type.
     * @param {string} providerType - The provider type to set fallback chain for.
     * @param {Array<string>} fallbackTypes - Array of fallback provider types.
     */
    setFallbackChain(providerType, fallbackTypes) {
        if (!Array.isArray(fallbackTypes)) {
            this._log('error', `Invalid fallbackTypes: must be an array`);
            return;
        }
        this.fallbackChain[providerType] = fallbackTypes;
        this._log('info', `Updated fallback chain for ${providerType}: ${fallbackTypes.join(' -> ')}`);
    }

    /**
     * Checks if all providers of a given type are unhealthy.
     * @param {string} providerType - The provider type to check.
     * @returns {boolean} True if all providers are unhealthy or disabled.
     */
    isAllProvidersUnhealthy(providerType) {
        const providers = this.providerStatus[providerType] || [];
        if (providers.length === 0) {
            return true;
        }
        return providers.every(p => !p.config.isHealthy || p.config.isDisabled);
    }

    /**
     * Gets statistics about provider health for a given type.
     * @param {string} providerType - The provider type to get stats for.
     * @returns {Object} Statistics object with total, healthy, unhealthy, and disabled counts.
     */
    getProviderStats(providerType) {
        const providers = this.providerStatus[providerType] || [];
        const stats = {
            total: providers.length,
            healthy: 0,
            unhealthy: 0,
            disabled: 0
        };
        
        for (const p of providers) {
            if (p.config.isDisabled) {
                stats.disabled++;
            } else if (p.config.isHealthy) {
                stats.healthy++;
            } else {
                stats.unhealthy++;
            }
        }
        
        return stats;
    }

    /**
     * Marks a provider as unhealthy (e.g., after an API error).
     * @param {string} providerType - The type of the provider.
     * @param {object} providerConfig - The configuration of the provider to mark.
     * @param {string} [errorMessage] - Optional error message to store.
     * @param {number} [statusCode] - Optional HTTP status code of the error.
     */
    markProviderUnhealthy(providerType, providerConfig, errorMessage = null, statusCode = null) {
        if (!providerConfig?.uuid) {
            this._log('error', 'Invalid providerConfig in markProviderUnhealthy');
            return;
        }

        const provider = this._findProvider(providerType, providerConfig.uuid);
        if (provider) {
            provider.config.errorCount++;
            provider.config.lastErrorTime = new Date().toISOString();
            // Update lastUsed time to prevent failed nodes from being repeatedly selected due to LRU strategy
            provider.config.lastUsed = new Date().toISOString();

            // Save error message
            if (errorMessage) {
                provider.config.lastErrorMessage = errorMessage;
            }

            // Save HTTP status code for health check scheduling
            if (statusCode !== null) {
                provider.config.lastErrorStatusCode = statusCode;
            }

            if (provider.config.errorCount >= this.maxErrorCount) {
                provider.config.isHealthy = false;
                this._log('warn', `Marked provider as unhealthy: ${providerConfig.uuid} for type ${providerType}. Status: ${statusCode || 'unknown'}. Total errors: ${provider.config.errorCount}`);

                // Record health event for timeline widget
                metricsService.recordHealthEvent({
                    providerUuid: providerConfig.uuid,
                    providerType: providerType,
                    eventType: 'unhealthy',
                    errorCode: statusCode || null,
                    errorMessage: errorMessage || null,
                });

                // Schedule appropriate health check based on error type
                if (this.autoHealthCheckEnabled) {
                    this._scheduleHealthCheck(providerType, provider.config);
                }
            } else {
                this._log('warn', `Provider ${providerConfig.uuid} for type ${providerType} error count: ${provider.config.errorCount}/${this.maxErrorCount}. Still healthy.`);
            }

            this._debouncedSave(providerType);
        }
    }

    /**
     * Marks a provider as healthy.
     * @param {string} providerType - The type of the provider.
     * @param {object} providerConfig - The configuration of the provider to mark.
     * @param {boolean} resetUsageCount - Whether to reset usage count (optional, default: false).
     * @param {string} [healthCheckModel] - Optional model name used for health check.
     */
    markProviderHealthy(providerType, providerConfig, resetUsageCount = false, healthCheckModel = null) {
        if (!providerConfig?.uuid) {
            this._log('error', 'Invalid providerConfig in markProviderHealthy');
            return;
        }

        const provider = this._findProvider(providerType, providerConfig.uuid);
        if (provider) {
            provider.config.isHealthy = true;
            provider.config.errorCount = 0;
            provider.config.lastErrorTime = null;
            provider.config.lastErrorMessage = null;

            // Reset auto health check state
            provider.config.lastErrorStatusCode = null;
            provider.config.quickRetryCount = 0;
            provider.config.quickRetryPhaseStartTime = null;
            provider.config.lastQuickRetryTime = null;
            provider.config.healthCheckScheduleType = null;

            // Clear any pending health check timer for this provider
            this._clearHealthCheckTimer(provider.config.uuid);

            // Update health check info
            provider.config.lastHealthCheckTime = new Date().toISOString();
            if (healthCheckModel) {
                provider.config.lastHealthCheckModel = healthCheckModel;
            }

            // Only reset usage count when explicitly requested
            if (resetUsageCount) {
                provider.config.usageCount = 0;
            } else {
                provider.config.usageCount++;
                provider.config.lastUsed = new Date().toISOString();
            }
            this._log('info', `Marked provider as healthy: ${provider.config.uuid} for type ${providerType}${resetUsageCount ? ' (usage count reset)' : ''}`);

            // Record health event for timeline widget
            metricsService.recordHealthEvent({
                providerUuid: providerConfig.uuid,
                providerType: providerType,
                eventType: 'healthy',
                errorCode: null,
                errorMessage: null,
            });

            this._debouncedSave(providerType);
        }
    }

    /**
     * Reset provider counters (error count and usage count)
     * @param {string} providerType - The type of the provider.
     * @param {object} providerConfig - The configuration of the provider to mark.
     */
    resetProviderCounters(providerType, providerConfig) {
        if (!providerConfig?.uuid) {
            this._log('error', 'Invalid providerConfig in resetProviderCounters');
            return;
        }

        const provider = this._findProvider(providerType, providerConfig.uuid);
        if (provider) {
            provider.config.errorCount = 0;
            provider.config.usageCount = 0;
            this._log('info', `Reset provider counters: ${provider.config.uuid} for type ${providerType}`);
            
            this._debouncedSave(providerType);
        }
    }

    /**
     * Disable specified provider
     * @param {string} providerType - Provider type
     * @param {object} providerConfig - Provider configuration
     */
    disableProvider(providerType, providerConfig) {
        if (!providerConfig?.uuid) {
            this._log('error', 'Invalid providerConfig in disableProvider');
            return;
        }

        const provider = this._findProvider(providerType, providerConfig.uuid);
        if (provider) {
            provider.config.isDisabled = true;
            this._log('info', `Disabled provider: ${providerConfig.uuid} for type ${providerType}`);
            this._debouncedSave(providerType);
        }
    }

    /**
     * Enable specified provider
     * @param {string} providerType - Provider type
     * @param {object} providerConfig - Provider configuration
     */
    enableProvider(providerType, providerConfig) {
        if (!providerConfig?.uuid) {
            this._log('error', 'Invalid providerConfig in enableProvider');
            return;
        }

        const provider = this._findProvider(providerType, providerConfig.uuid);
        if (provider) {
            provider.config.isDisabled = false;
            this._log('info', `Enabled provider: ${providerConfig.uuid} for type ${providerType}`);
            this._debouncedSave(providerType);
        }
    }

    /**
     * Performs health checks on all providers in the pool.
     * This method would typically be called periodically (e.g., via cron job).
     */
    async performHealthChecks(isInit = false) {
        this._log('info', 'Performing health checks on all providers...');
        const now = new Date();
        
        for (const providerType in this.providerStatus) {
            for (const providerStatus of this.providerStatus[providerType]) {
                const providerConfig = providerStatus.config;

                // Only attempt to health check unhealthy providers after a certain interval
                if (!providerStatus.config.isHealthy && providerStatus.config.lastErrorTime &&
                    (now.getTime() - new Date(providerStatus.config.lastErrorTime).getTime() < this.healthCheckInterval)) {
                    this._log('debug', `Skipping health check for ${providerConfig.uuid} (${providerType}). Last error too recent.`);
                    continue;
                }

                try {
                    // Perform actual health check based on provider type
                    const healthResult = await this._checkProviderHealth(providerType, providerConfig);
                    
                    if (healthResult === null) {
                        this._log('debug', `Health check for ${providerConfig.uuid} (${providerType}) skipped: Check not implemented.`);
                        this.resetProviderCounters(providerType, providerConfig);
                        continue;
                    }
                    
                    if (healthResult.success) {
                        if (!providerStatus.config.isHealthy) {
                            // Provider was unhealthy but is now healthy
                            // Don't reset usage count when recovering health, keep original value
                            this.markProviderHealthy(providerType, providerConfig, true, healthResult.modelName);
                            this._log('info', `Health check for ${providerConfig.uuid} (${providerType}): Marked Healthy (actual check)`);
                        } else {
                            // Provider was already healthy and still is
                            // Only reset usage count during initialization
                            this.markProviderHealthy(providerType, providerConfig, true, healthResult.modelName);
                            this._log('debug', `Health check for ${providerConfig.uuid} (${providerType}): Still Healthy`);
                        }
                    } else {
                        // Provider is not healthy
                        this._log('warn', `Health check for ${providerConfig.uuid} (${providerType}) failed: ${healthResult.errorMessage || 'Provider is not responding correctly.'}`);
                        this.markProviderUnhealthy(providerType, providerConfig, healthResult.errorMessage);
                        
                        // Update health check time and model (record even if failed)
                        providerStatus.config.lastHealthCheckTime = new Date().toISOString();
                        if (healthResult.modelName) {
                            providerStatus.config.lastHealthCheckModel = healthResult.modelName;
                        }
                    }

                } catch (error) {
                    this._log('error', `Health check for ${providerConfig.uuid} (${providerType}) failed: ${error.message}`);
                    // If a health check fails, mark it unhealthy, which will update error count and lastErrorTime
                    this.markProviderUnhealthy(providerType, providerConfig, error.message);
                }
            }
        }
    }

    /**
     * Build health check requests (returns multiple formats for retry)
     * @private
     * @returns {Array} Request format array, sorted by priority
     */
    _buildHealthCheckRequests(providerType, modelName) {
        const baseMessage = { role: 'user', content: 'Hi' };
        const requests = [];
        
        // Gemini uses contents format
        if (providerType.startsWith('gemini')) {
            requests.push({
                contents: [{
                    role: 'user',
                    parts: [{ text: baseMessage.content }]
                }]
            });
            return requests;
        }
        
        // OpenAI Custom Responses uses special format
        if (providerType === MODEL_PROVIDER.OPENAI_CUSTOM_RESPONSES) {
            requests.push({
                input: [baseMessage],
                model: modelName
            });
            return requests;
        }
        
        // Other providers (OpenAI, Claude) use standard messages format
        requests.push({
            messages: [baseMessage],
            model: modelName
        });
        
        return requests;
    }

    /**
     * Performs an actual health check for a specific provider.
     * @param {string} providerType - The type of the provider.
     * @param {object} providerConfig - The configuration of the provider to check.
     * @param {boolean} forceCheck - If true, ignore checkHealth config and force the check.
     * @returns {Promise<{success: boolean, modelName: string, errorMessage: string}|null>} - Health check result object or null if check not implemented.
     */
    async _checkProviderHealth(providerType, providerConfig, forceCheck = false) {
        // Determine model name for health check
        const modelName = providerConfig.checkModelName ||
                        ProviderPoolManager.DEFAULT_HEALTH_CHECK_MODELS[providerType];
        
        // If health check is not enabled and not a forced check, return null
        if (!providerConfig.checkHealth && !forceCheck) {
            return null;
        }

        if (!modelName) {
            this._log('warn', `Unknown provider type for health check: ${providerType}`);
            return { success: false, modelName: null, errorMessage: 'Unknown provider type for health check' };
        }

        // Perform health check using internal service adapter
        const proxyKeys = ['GEMINI', 'OPENAI', 'CLAUDE'];
        const tempConfig = {
            ...providerConfig,
            MODEL_PROVIDER: providerType
        };
        
        proxyKeys.forEach(key => {
            const proxyKey = `USE_SYSTEM_PROXY_${key}`;
            if (this.globalConfig[proxyKey] !== undefined) {
                tempConfig[proxyKey] = this.globalConfig[proxyKey];
            }
        });

        const serviceAdapter = getServiceAdapter(tempConfig);
        
        // Get all possible request formats
        const healthCheckRequests = this._buildHealthCheckRequests(providerType, modelName);
        
        // Retry mechanism: try different request formats
        const maxRetries = healthCheckRequests.length;
        let lastError = null;
        
        for (let i = 0; i < maxRetries; i++) {
            const healthCheckRequest = healthCheckRequests[i];
            try {
                this._log('debug', `Health check attempt ${i + 1}/${maxRetries} for ${modelName}: ${JSON.stringify(healthCheckRequest)}`);
                await serviceAdapter.generateContent(modelName, healthCheckRequest);
                return { success: true, modelName, errorMessage: null };
            } catch (error) {
                lastError = error;
                this._log('debug', `Health check attempt ${i + 1} failed for ${providerType}: ${error.message}`);
                // Continue to try next format
            }
        }
        
        // All attempts failed
        this._log('error', `Health check failed for ${providerType} after ${maxRetries} attempts: ${lastError?.message}`);
        return { success: false, modelName, errorMessage: lastError?.message || 'All health check attempts failed', statusCode: lastError?.response?.status || null };
    }

    /**
     * Schedules a health check for an unhealthy provider based on error type.
     * - 429 Rate Limit: Schedule 3-hour check (skip quick retries)
     * - Other errors: Quick retry 3 times (10 sec apart), then 3-hour fallback
     * @private
     * @param {string} providerType - Provider type
     * @param {object} providerConfig - Provider configuration
     */
    _scheduleHealthCheck(providerType, providerConfig) {
        const uuid = providerConfig.uuid;

        // Clear any existing timer for this provider
        this._clearHealthCheckTimer(uuid);

        const statusCode = providerConfig.lastErrorStatusCode;
        const isRateLimitError = statusCode === 429;

        if (isRateLimitError) {
            // 429 Rate Limit: Schedule long interval (3 hours) - don't waste quota
            providerConfig.healthCheckScheduleType = 'rate_limit';
            providerConfig.quickRetryCount = 0;
            providerConfig.quickRetryPhaseStartTime = null;

            this._log('info', `[Auto Health Check] Rate limit (429) for ${uuid}. Scheduling check in ${this.rateLimitHealthCheckIntervalMs / 1000 / 60} minutes.`);
            this._setHealthCheckTimer(providerType, providerConfig, this.rateLimitHealthCheckIntervalMs);

        } else {
            // Other errors: Start or continue quick retry phase
            if (providerConfig.quickRetryCount < this.quickRetryMaxCount) {
                // Quick retry phase
                providerConfig.healthCheckScheduleType = 'quick_retry';

                if (providerConfig.quickRetryCount === 0) {
                    providerConfig.quickRetryPhaseStartTime = new Date().toISOString();
                }

                this._log('info', `[Auto Health Check] Quick retry ${providerConfig.quickRetryCount + 1}/${this.quickRetryMaxCount} for ${uuid} in ${this.quickRetryIntervalMs / 1000} seconds.`);
                this._setHealthCheckTimer(providerType, providerConfig, this.quickRetryIntervalMs);

            } else {
                // Quick retries exhausted, fall back to long interval
                providerConfig.healthCheckScheduleType = 'standard';

                this._log('info', `[Auto Health Check] Quick retries exhausted for ${uuid}. Scheduling check in ${this.standardHealthCheckIntervalMs / 1000 / 60} minutes.`);
                this._setHealthCheckTimer(providerType, providerConfig, this.standardHealthCheckIntervalMs);
            }
        }

        this._debouncedSave(providerType);
    }

    /**
     * Sets a setTimeout timer for a health check.
     * @private
     * @param {string} providerType - Provider type
     * @param {object} providerConfig - Provider configuration
     * @param {number} delayMs - Delay in milliseconds
     */
    _setHealthCheckTimer(providerType, providerConfig, delayMs) {
        const uuid = providerConfig.uuid;

        this.healthCheckTimers[uuid] = setTimeout(async () => {
            await this._executeScheduledHealthCheck(providerType, providerConfig);
        }, delayMs);

        this._log('debug', `[Auto Health Check] Timer set for ${uuid}: ${delayMs}ms (${delayMs / 1000 / 60} minutes)`);
    }

    /**
     * Clears existing health check timer for a provider.
     * @private
     * @param {string} uuid - Provider UUID
     */
    _clearHealthCheckTimer(uuid) {
        if (this.healthCheckTimers[uuid]) {
            clearTimeout(this.healthCheckTimers[uuid]);
            delete this.healthCheckTimers[uuid];
            this._log('debug', `[Auto Health Check] Timer cleared for ${uuid}`);
        }
    }

    /**
     * Executes a scheduled health check for a single provider.
     * @private
     * @param {string} providerType - Provider type
     * @param {object} providerConfig - Provider configuration
     */
    async _executeScheduledHealthCheck(providerType, providerConfig) {
        const uuid = providerConfig.uuid;
        const scheduleType = providerConfig.healthCheckScheduleType;
        const retryInfo = scheduleType === 'quick_retry'
            ? ` (Quick retry ${providerConfig.quickRetryCount + 1}/${this.quickRetryMaxCount})`
            : scheduleType === 'rate_limit'
                ? ' (Rate limit recovery)'
                : scheduleType === 'standard'
                    ? ' (Standard interval)'
                    : '';
        this._log('info', `[Auto Health Check] Executing scheduled check for ${uuid} (${providerType})${retryInfo}`);

        try {
            const healthResult = await this._checkProviderHealth(providerType, providerConfig, true);

            if (healthResult === null) {
                this._log('debug', `[Auto Health Check] Health check skipped for ${uuid} - not implemented`);
                return;
            }

            if (healthResult.success) {
                // Provider recovered!
                this._log('info', `[Auto Health Check] ${uuid} recovered! Marking healthy.`);
                this.markProviderHealthy(providerType, providerConfig, false, healthResult.modelName);

            } else {
                // Still unhealthy - update error info
                providerConfig.lastErrorMessage = healthResult.errorMessage;
                if (healthResult.statusCode) {
                    providerConfig.lastErrorStatusCode = healthResult.statusCode;
                }

                // If in quick retry phase, increment counter and log with count
                if (providerConfig.healthCheckScheduleType === 'quick_retry') {
                    providerConfig.quickRetryCount++;
                    providerConfig.lastQuickRetryTime = new Date().toISOString();

                    if (providerConfig.quickRetryCount >= this.quickRetryMaxCount) {
                        this._log('warn', `[Auto Health Check] ${uuid} failed all ${this.quickRetryMaxCount} quick retries. Switching to standard interval. Error: ${healthResult.errorMessage}`);
                    } else {
                        this._log('warn', `[Auto Health Check] ${uuid} quick retry ${providerConfig.quickRetryCount}/${this.quickRetryMaxCount} failed. Next retry in ${this.quickRetryIntervalMs / 1000}s. Error: ${healthResult.errorMessage}`);
                    }
                } else {
                    this._log('warn', `[Auto Health Check] ${uuid} still unhealthy: ${healthResult.errorMessage}`);
                }

                // Reschedule based on current state
                this._scheduleHealthCheck(providerType, providerConfig);
            }

        } catch (error) {
            // Extract status code from error
            const errorStatusCode = error.response?.status || error.status || null;
            if (errorStatusCode) {
                providerConfig.lastErrorStatusCode = errorStatusCode;
            }

            // On error, increment quick retry if in that phase and log with count
            if (providerConfig.healthCheckScheduleType === 'quick_retry') {
                providerConfig.quickRetryCount++;
                providerConfig.lastQuickRetryTime = new Date().toISOString();

                if (providerConfig.quickRetryCount >= this.quickRetryMaxCount) {
                    this._log('error', `[Auto Health Check] ${uuid} failed all ${this.quickRetryMaxCount} quick retries. Switching to standard interval. Error: ${error.message}`);
                } else {
                    this._log('error', `[Auto Health Check] ${uuid} quick retry ${providerConfig.quickRetryCount}/${this.quickRetryMaxCount} failed. Next retry in ${this.quickRetryIntervalMs / 1000}s. Error: ${error.message}`);
                }
            } else {
                this._log('error', `[Auto Health Check] Error checking ${uuid}: ${error.message}`);
            }

            this._scheduleHealthCheck(providerType, providerConfig);
        }
    }

    /**
     * Starts the auto health check system.
     * Should be called after server initialization.
     * Schedules health checks for all currently unhealthy providers.
     */
    startAutoHealthChecks() {
        if (!this.autoHealthCheckEnabled) {
            this._log('info', '[Auto Health Check] Auto health checks are disabled');
            return;
        }

        this._log('info', '[Auto Health Check] Starting auto health check system');

        // Schedule health checks for all currently unhealthy providers
        for (const providerType in this.providerStatus) {
            for (const providerStatus of this.providerStatus[providerType]) {
                const config = providerStatus.config;

                if (!config.isHealthy && !config.isDisabled) {
                    this._log('info', `[Auto Health Check] Scheduling initial check for unhealthy provider: ${config.uuid}`);
                    this._scheduleHealthCheck(providerType, config);
                }
            }
        }
    }

    /**
     * Stops all pending health check timers.
     * Should be called on graceful shutdown.
     */
    stopAutoHealthChecks() {
        this._log('info', '[Auto Health Check] Stopping all auto health checks');

        for (const uuid in this.healthCheckTimers) {
            this._clearHealthCheckTimer(uuid);
        }
    }

    /**
     * Optimization 1: Add debounced save method
     * Delay save operation to avoid frequent file I/O
     * @private
     */
    _debouncedSave(providerType) {
        // Add pending providerType to the set
        this.pendingSaves.add(providerType);
        
        // Clear previous timer
        if (this.saveTimer) {
            clearTimeout(this.saveTimer);
        }
        
        // Set new timer
        this.saveTimer = setTimeout(() => {
            this._flushPendingSaves();
        }, this.saveDebounceTime);
    }
    
    /**
     * Batch save all pending providerTypes (optimized to single file write)
     * @private
     */
    async _flushPendingSaves() {
        const typesToSave = Array.from(this.pendingSaves);
        if (typesToSave.length === 0) return;
        
        this.pendingSaves.clear();
        this.saveTimer = null;
        
        try {
            const filePath = this.globalConfig.PROVIDER_POOLS_FILE_PATH || 'configs/provider_pools.json';
            let currentPools = {};
            
            // Read file once
            try {
                const fileContent = await fs.promises.readFile(filePath, 'utf8');
                currentPools = JSON.parse(fileContent);
            } catch (readError) {
                if (readError.code === 'ENOENT') {
                    this._log('info', 'configs/provider_pools.json does not exist, creating new file.');
                } else {
                    throw readError;
                }
            }

            // Update all pending providerTypes
            for (const providerType of typesToSave) {
                if (this.providerStatus[providerType]) {
                    currentPools[providerType] = this.providerStatus[providerType].map(p => {
                        // Convert Date objects to ISOString if they exist
                        const config = { ...p.config };
                        if (config.lastUsed instanceof Date) {
                            config.lastUsed = config.lastUsed.toISOString();
                        }
                        if (config.lastErrorTime instanceof Date) {
                            config.lastErrorTime = config.lastErrorTime.toISOString();
                        }
                        if (config.lastHealthCheckTime instanceof Date) {
                            config.lastHealthCheckTime = config.lastHealthCheckTime.toISOString();
                        }
                        if (config.quickRetryPhaseStartTime instanceof Date) {
                            config.quickRetryPhaseStartTime = config.quickRetryPhaseStartTime.toISOString();
                        }
                        if (config.lastQuickRetryTime instanceof Date) {
                            config.lastQuickRetryTime = config.lastQuickRetryTime.toISOString();
                        }
                        return config;
                    });
                } else {
                    this._log('warn', `Attempted to save unknown providerType: ${providerType}`);
                }
            }
            
            // Write file once
            await fs.promises.writeFile(filePath, JSON.stringify(currentPools, null, 2), 'utf8');
            this._log('info', `configs/provider_pools.json updated successfully for types: ${typesToSave.join(', ')}`);
        } catch (error) {
            this._log('error', `Failed to write provider_pools.json: ${error.message}`);
        }
    }

}