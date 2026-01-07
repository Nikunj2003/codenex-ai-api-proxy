// Provider management module

import { providerStats, updateProviderStats } from './constants.js';
import { showToast } from './utils.js';
import { fileUploadHandler } from './file-upload.js';
import { loadConfigList } from './upload-config-manager.js';
import { setServiceMode } from './event-handlers.js';

/**
 * Load service running mode information
 */
async function loadServiceModeInfo() {
    try {
        const data = await window.apiClient.get('/service-mode');
        
        const serviceModeEl = document.getElementById('serviceMode');
        const processPidEl = document.getElementById('processPid');
        const platformInfoEl = document.getElementById('platformInfo');

        // Update service mode to event-handlers
        setServiceMode(data.mode || 'worker');

        // Update restart/reload button display
        updateRestartButton(data.mode);
        
        if (serviceModeEl) {
            const modeText = data.mode === 'worker'
                ? 'Worker Mode'
                : 'Standalone Mode';
            const canRestartIcon = data.canAutoRestart
                ? '<i class="fas fa-check-circle" style="color: #10b981; margin-left: 4px;" title="Can auto restart"></i>'
                : '';
            serviceModeEl.innerHTML = modeText;
        }
        
        if (processPidEl) {
            processPidEl.textContent = data.pid || '--';
        }

        if (platformInfoEl) {
            // Format platform info
            const platformMap = {
                'win32': 'Windows',
                'darwin': 'macOS',
                'linux': 'Linux',
                'freebsd': 'FreeBSD'
            };
            platformInfoEl.textContent = platformMap[data.platform] || data.platform || '--';
        }
        
    } catch (error) {
        console.error('Failed to load service mode info:', error);
    }
}

/**
 * Update restart/reload button display based on service mode
 * @param {string} mode - Service mode ('worker' or 'standalone')
 */
function updateRestartButton(mode) {
    const restartBtn = document.getElementById('restartBtn');
    const restartBtnIcon = document.getElementById('restartBtnIcon');
    const restartBtnText = document.getElementById('restartBtnText');
    
    if (!restartBtn) return;

    if (mode === 'standalone') {
        // Standalone mode: show "Reload" button
        if (restartBtnIcon) {
            restartBtnIcon.className = 'fas fa-sync-alt';
        }
        if (restartBtnText) {
            restartBtnText.textContent = 'Reload';
            restartBtnText.setAttribute('data-i18n', 'header.reload');
        }
        restartBtn.setAttribute('aria-label', 'Reload');
        restartBtn.setAttribute('data-i18n-aria-label', 'header.reload');
        restartBtn.title = 'Reload';
    } else {
        // Worker mode: show "Restart" button
        if (restartBtnIcon) {
            restartBtnIcon.className = 'fas fa-redo';
        }
        if (restartBtnText) {
            restartBtnText.textContent = 'Restart';
            restartBtnText.setAttribute('data-i18n', 'header.restart');
        }
        restartBtn.setAttribute('aria-label', 'Restart');
        restartBtn.setAttribute('data-i18n-aria-label', 'header.restart');
        restartBtn.title = 'Restart';
    }
}

/**
 * Load provider list
 */
async function loadProviders() {
    try {
        // Load service mode info on first call
        await loadServiceModeInfo();

        const data = await window.apiClient.get('/providers');
        renderProviders(data);
    } catch (error) {
        console.error('Failed to load providers:', error);
    }
}

/**
 * Render provider list
 * @param {Object} providers - Provider data
 */
function renderProviders(providers) {
    const container = document.getElementById('providersList');
    if (!container) return;
    
    container.innerHTML = '';

    // Check if there is provider pool data
    const hasProviders = Object.keys(providers).length > 0;
    const statsGrid = document.querySelector('#providers .stats-grid');

    // Always show stats cards
    if (statsGrid) statsGrid.style.display = 'grid';

    // Define display order for all supported providers
    const providerDisplayOrder = [
        'gemini-cli-oauth',
        'gemini-antigravity',
        'openai-custom',
        'claude-custom',
        'openaiResponses-custom'
    ];
    
    // Get all provider types and sort by specified order
    // Prioritize displaying all predefined provider types, even if some have no data
    let allProviderTypes;
    if (hasProviders) {
        // Merge predefined types and actual types, ensuring all predefined providers are displayed
        const actualProviderTypes = Object.keys(providers);
        allProviderTypes = [...new Set([...providerDisplayOrder, ...actualProviderTypes])];
    } else {
        allProviderTypes = providerDisplayOrder;
    }
    const sortedProviderTypes = providerDisplayOrder.filter(type => allProviderTypes.includes(type))
        .concat(allProviderTypes.filter(type => !providerDisplayOrder.includes(type)));

    // Calculate total statistics
    let totalAccounts = 0;
    let totalHealthy = 0;

    // Render by sorted provider types
    sortedProviderTypes.forEach((providerType) => {
        const accounts = hasProviders ? providers[providerType] || [] : [];
        const providerDiv = document.createElement('div');
        providerDiv.className = 'provider-item';
        providerDiv.dataset.providerType = providerType;
        providerDiv.style.cursor = 'pointer';

        const healthyCount = accounts.filter(acc => acc.isHealthy).length;
        const totalCount = accounts.length;
        const usageCount = accounts.reduce((sum, acc) => sum + (acc.usageCount || 0), 0);
        const errorCount = accounts.reduce((sum, acc) => sum + (acc.errorCount || 0), 0);
        
        totalAccounts += totalCount;
        totalHealthy += healthyCount;

        // Update global stats variable
        if (!providerStats.providerTypeStats[providerType]) {
            providerStats.providerTypeStats[providerType] = {
                totalAccounts: 0,
                healthyAccounts: 0,
                totalUsage: 0,
                totalErrors: 0,
                lastUpdate: null
            };
        }
        
        const typeStats = providerStats.providerTypeStats[providerType];
        typeStats.totalAccounts = totalCount;
        typeStats.healthyAccounts = healthyCount;
        typeStats.totalUsage = usageCount;
        typeStats.totalErrors = errorCount;
        typeStats.lastUpdate = new Date().toISOString();

        // Set special styles for empty state
        const isEmptyState = !hasProviders || totalCount === 0;
        const statusClass = isEmptyState ? 'status-empty' : (healthyCount === totalCount ? 'status-healthy' : 'status-unhealthy');
        const statusIcon = isEmptyState ? 'fa-info-circle' : (healthyCount === totalCount ? 'fa-check-circle' : 'fa-exclamation-triangle');
        const statusText = isEmptyState ? 'No providers configured' : `${healthyCount}/${totalCount} healthy`;

        providerDiv.innerHTML = `
            <div class="provider-header">
                <div class="provider-name">
                    <span class="provider-type-text">${providerType}</span>
                </div>
                <div class="provider-header-right">
                    ${generateAuthButton(providerType)}
                    <div class="provider-status ${statusClass}">
                        <i class="fas fa-${statusIcon}"></i>
                        <span>${statusText}</span>
                    </div>
                </div>
            </div>
            <div class="provider-stats">
                <div class="provider-stat">
                    <span class="provider-stat-label">Total Accounts</span>
                    <span class="provider-stat-value">${totalCount}</span>
                </div>
                <div class="provider-stat">
                    <span class="provider-stat-label">Healthy Accounts</span>
                    <span class="provider-stat-value">${healthyCount}</span>
                </div>
                <div class="provider-stat">
                    <span class="provider-stat-label">Usage Count</span>
                    <span class="provider-stat-value">${usageCount}</span>
                </div>
                <div class="provider-stat">
                    <span class="provider-stat-label">Error Count</span>
                    <span class="provider-stat-value">${errorCount}</span>
                </div>
            </div>
        `;

        // If empty state, add special styles
        if (isEmptyState) {
            providerDiv.classList.add('empty-provider');
        }

        // Add click event - entire provider group is clickable
        providerDiv.addEventListener('click', (e) => {
            e.preventDefault();
            openProviderManager(providerType);
        });

        container.appendChild(providerDiv);

        // Add event listener for authorization button
        const authBtn = providerDiv.querySelector('.generate-auth-btn');
        if (authBtn) {
            authBtn.addEventListener('click', (e) => {
                e.stopPropagation(); // Prevent event bubbling to parent element
                handleGenerateAuthUrl(providerType);
            });
        }
    });
    
    // Update stats card data
    const activeProviders = hasProviders ? Object.keys(providers).length : 0;
    updateProviderStatsDisplay(activeProviders, totalHealthy, totalAccounts);
}

/**
 * Update provider statistics display
 * @param {number} activeProviders - Number of active providers
 * @param {number} healthyProviders - Number of healthy providers
 * @param {number} totalAccounts - Total number of accounts
 */
function updateProviderStatsDisplay(activeProviders, healthyProviders, totalAccounts) {
    // Update global stats variable
    const newStats = {
        activeProviders,
        healthyProviders,
        totalAccounts,
        lastUpdateTime: new Date().toISOString()
    };
    
    updateProviderStats(newStats);

    // Calculate total requests and errors
    let totalUsage = 0;
    let totalErrors = 0;
    Object.values(providerStats.providerTypeStats).forEach(typeStats => {
        totalUsage += typeStats.totalUsage || 0;
        totalErrors += typeStats.totalErrors || 0;
    });
    
    const finalStats = {
        ...newStats,
        totalRequests: totalUsage,
        totalErrors: totalErrors
    };
    
    updateProviderStats(finalStats);

    // Modified: count "active providers" and "active connections" based on usage count
    // "Active Providers": count provider types with usage (usageCount > 0)
    let activeProvidersByUsage = 0;
    Object.entries(providerStats.providerTypeStats).forEach(([providerType, typeStats]) => {
        if (typeStats.totalUsage > 0) {
            activeProvidersByUsage++;
        }
    });

    // "Active Connections": sum of usage count for all provider accounts
    const activeConnections = totalUsage;

    // Update page display
    const activeProvidersEl = document.getElementById('activeProviders');
    const healthyProvidersEl = document.getElementById('healthyProviders');
    const activeConnectionsEl = document.getElementById('activeConnections');
    
    if (activeProvidersEl) activeProvidersEl.textContent = activeProvidersByUsage;
    if (healthyProvidersEl) healthyProvidersEl.textContent = healthyProviders;
    if (activeConnectionsEl) activeConnectionsEl.textContent = activeConnections;

    // Print debug info to console
    console.log('Provider Stats Updated:', {
        activeProviders,
        activeProvidersByUsage,
        healthyProviders,
        totalAccounts,
        totalUsage,
        totalErrors,
        providerTypeStats: providerStats.providerTypeStats
    });
}

/**
 * Open provider management modal
 * @param {string} providerType - Provider type
 */
async function openProviderManager(providerType) {
    try {
        const data = await window.apiClient.get(`/providers/${encodeURIComponent(providerType)}`);
        
        showProviderManagerModal(data);
    } catch (error) {
        console.error('Failed to load provider details:', error);
        showToast('Error', 'Failed to load provider details', 'error');
    }
}

/**
 * Generate authorization button HTML
 * @param {string} providerType - Provider type
 * @returns {string} Authorization button HTML
 */
function generateAuthButton(providerType) {
    // Only show authorization button for OAuth providers
    const oauthProviders = ['gemini-cli-oauth', 'gemini-antigravity'];

    if (!oauthProviders.includes(providerType)) {
        return '';
    }

    return `
        <button class="generate-auth-btn" title="Generate OAuth authorization link">
            <i class="fas fa-key"></i>
            <span>Generate Auth</span>
        </button>
    `;
}

/**
 * Handle generate authorization URL
 * @param {string} providerType - Provider type
 */
async function handleGenerateAuthUrl(providerType) {
    await executeGenerateAuthUrl(providerType, {});
}

/**
 * Execute generate authorization URL
 * @param {string} providerType - Provider type
 * @param {Object} extraOptions - Extra options
 */
async function executeGenerateAuthUrl(providerType, extraOptions = {}) {
    try {
        showToast('Info', 'Initializing authorization...', 'info');

        // Use getProviderKey from fileUploadHandler to get directory name
        const providerDir = fileUploadHandler.getProviderKey(providerType);

        const response = await window.apiClient.post(
            `/providers/${encodeURIComponent(providerType)}/generate-auth-url`,
            {
                saveToConfigs: true,
                providerDir: providerDir,
                ...extraOptions
            }
        );
        
        if (response.success && response.authUrl) {
            // If targetInputId is provided, set up success listener
            if (extraOptions.targetInputId) {
                const targetInputId = extraOptions.targetInputId;
                const handleSuccess = (e) => {
                    const data = e.detail;
                    if (data.provider === providerType && data.relativePath) {
                        const input = document.getElementById(targetInputId);
                        if (input) {
                            input.value = data.relativePath;
                            input.dispatchEvent(new Event('input', { bubbles: true }));
                            showToast('Success', 'Authorization successful', 'success');
                        }
                        window.removeEventListener('oauth_success_event', handleSuccess);
                    }
                };
                window.addEventListener('oauth_success_event', handleSuccess);
            }

            // Show authorization info modal
            showAuthModal(response.authUrl, response.authInfo);
        } else {
            showToast('Error', 'Authorization failed', 'error');
        }
    } catch (error) {
        console.error('Failed to generate authorization URL:', error);
        showToast('Error', 'Authorization failed: ' + error.message, 'error');
    }
}

/**
 * Get provider's authorization file path
 * @param {string} provider - Provider type
 * @returns {string} Authorization file path
 */
function getAuthFilePath(provider) {
    const authFilePaths = {
        'gemini-cli-oauth': '~/.gemini/oauth_creds.json',
        'gemini-antigravity': '~/.antigravity/oauth_creds.json'
    };
    return authFilePaths[provider] || 'Unknown Path';
}

/**
 * Show authorization info modal
 * @param {string} authUrl - Authorization URL
 * @param {Object} authInfo - Authorization info
 */
function showAuthModal(authUrl, authInfo) {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.style.display = 'flex';

    // Get authorization file path
    const authFilePath = getAuthFilePath(authInfo.provider);

    // Get required port number (from authInfo or current page URL)
    const requiredPort = authInfo.callbackPort || authInfo.port || window.location.port || '3000';
    const isDeviceFlow = false;

    const instructionsHtml = `
        <div class="auth-instructions">
            <h4>Steps</h4>
            <ol>
                <li>Click the button below to open the authorization page</li>
                <li>Log in with your Google account</li>
                <li>Grant permission to access the service</li>
                <li>Wait for the page to redirect back automatically</li>
            </ol>
        </div>
    `;
    
    modal.innerHTML = `
        <div class="modal-content" style="max-width: 600px;">
            <div class="modal-header">
                <h3><i class="fas fa-key"></i> <span>OAuth Authorization</span></h3>
                <button class="modal-close">&times;</button>
            </div>
            <div class="modal-body">
                <div class="auth-info">
                    <p><strong>Provider:</strong> ${authInfo.provider}</p>
                    <div class="port-info-section" style="margin: 12px 0; padding: 12px; background: #fef3c7; border: 1px solid #fcd34d; border-radius: 8px;">
                        <div style="margin: 0; display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                            <i class="fas fa-network-wired" style="color: #d97706;"></i>
                            <strong>Required Port:</strong>
                            ${isDeviceFlow ?
                                `<code style="background: #fff; padding: 2px 8px; border-radius: 4px; font-weight: bold; color: #d97706;">${requiredPort}</code>` :
                                `<div style="display: flex; align-items: center; gap: 4px;">
                                    <input type="number" class="auth-port-input" value="${requiredPort}" style="width: 80px; padding: 2px 8px; border: 1px solid #d97706; border-radius: 4px; font-weight: bold; color: #d97706; background: white;">
                                    <button class="regenerate-port-btn" title="Generate" style="background: none; border: 1px solid #d97706; border-radius: 4px; cursor: pointer; color: #d97706; padding: 2px 6px;">
                                        <i class="fas fa-sync-alt"></i>
                                    </button>
                                </div>`
                            }
                        </div>
                        <p style="margin: 8px 0 0 0; font-size: 0.85rem; color: #92400e;">Ensure this port is accessible for the OAuth callback</p>
                    </div>
                    ${instructionsHtml}
                    <div class="auth-url-section">
                        <label>Authorization URL:</label>
                        <div class="auth-url-container">
                            <input type="text" readonly value="${authUrl}" class="auth-url-input">
                            <button class="copy-btn" title="Copy link">
                                <i class="fas fa-copy"></i>
                            </button>
                        </div>
                    </div>
                </div>
            </div>
            <div class="modal-footer">
                <button class="modal-cancel">Cancel</button>
                <button class="open-auth-btn">
                    <i class="fas fa-external-link-alt"></i>
                    <span>Open in Browser</span>
                </button>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);

    // Close button event
    const closeBtn = modal.querySelector('.modal-close');
    const cancelBtn = modal.querySelector('.modal-cancel');
    [closeBtn, cancelBtn].forEach(btn => {
        btn.addEventListener('click', () => {
            modal.remove();
        });
    });

    // Regenerate button event
    const regenerateBtn = modal.querySelector('.regenerate-port-btn');
    if (regenerateBtn) {
        regenerateBtn.onclick = async () => {
            const newPort = modal.querySelector('.auth-port-input').value;
            if (newPort && newPort !== requiredPort) {
                modal.remove();
                // Construct parameters for re-request
                const options = { ...authInfo, port: newPort };
                // Remove fields that don't need to be passed back to backend
                delete options.provider;
                delete options.redirectUri;
                delete options.callbackPort;
                
                await executeGenerateAuthUrl(authInfo.provider, options);
            }
        };
    }

    // Copy link button
    const copyBtn = modal.querySelector('.copy-btn');
    copyBtn.addEventListener('click', () => {
        const input = modal.querySelector('.auth-url-input');
        input.select();
        document.execCommand('copy');
        showToast('Success', 'Copied to clipboard', 'success');
    });

    // Open in browser button
    const openBtn = modal.querySelector('.open-auth-btn');
    openBtn.addEventListener('click', () => {
        // Open in sub-window to monitor URL changes
        const width = 600;
        const height = 700;
        const left = (window.screen.width - width) / 2 + 600;
        const top = (window.screen.height - height) / 2;
        
        const authWindow = window.open(
            authUrl,
            'OAuthAuthWindow',
            `width=${width},height=${height},left=${left},top=${top},status=no,resizable=yes,scrollbars=yes`
        );

        // Listen for OAuth success event, auto-close window and modal
        const handleOAuthSuccess = () => {
            if (authWindow && !authWindow.closed) {
                authWindow.close();
            }
            modal.remove();
            window.removeEventListener('oauth_success_event', handleOAuthSuccess);

            // Refresh config and provider list after successful authorization
            loadProviders();
            loadConfigList();
        };
        window.addEventListener('oauth_success_event', handleOAuthSuccess);
        
        if (authWindow) {
            showToast('Info', 'Authorization window opened', 'info');

            // Add manual callback URL input UI
            const urlSection = modal.querySelector('.auth-url-section');
            if (urlSection && !modal.querySelector('.manual-callback-section')) {
            const manualInputHtml = `
                <div class="manual-callback-section" style="margin-top: 20px; padding: 15px; background: #fffbeb; border: 1px solid #fef3c7; border-radius: 8px;">
                    <h4 style="color: #92400e; margin-bottom: 8px;"><i class="fas fa-exclamation-circle"></i> <span>Manual Callback</span></h4>
                    <p style="font-size: 0.875rem; color: #b45309; margin-bottom: 10px;">If the automatic redirect doesn't work, paste the callback URL here</p>
                    <div class="auth-url-container" style="display: flex; gap: 5px;">
                        <input type="text" class="manual-callback-input" placeholder="Paste callback URL (containing code=...)" style="flex: 1; padding: 8px; border: 1px solid #fcd34d; border-radius: 4px; background: white; color: black;">
                        <button class="btn btn-success apply-callback-btn" style="padding: 8px 15px; white-space: nowrap; background: #059669; color: white; border: none; border-radius: 4px; cursor: pointer;">
                            <i class="fas fa-check"></i> <span>Submit</span>
                        </button>
                    </div>
                </div>
            `;
            urlSection.insertAdjacentHTML('afterend', manualInputHtml);
            }

            const manualInput = modal.querySelector('.manual-callback-input');
            const applyBtn = modal.querySelector('.apply-callback-btn');

            // Core logic for processing callback URL
            const processCallback = (urlStr) => {
                try {
                    // Try to clean URL (some users may copy extra text)
                    const cleanUrlStr = urlStr.trim().match(/https?:\/\/[^\s]+/)?.[0] || urlStr.trim();
                    const url = new URL(cleanUrlStr);

                    if (url.searchParams.has('code') || url.searchParams.has('token')) {
                        clearInterval(pollTimer);
                        // Construct locally processable URL, only modify hostname, keep original URL port
                        const localUrl = new URL(url.href);
                        localUrl.hostname = window.location.hostname;
                        localUrl.protocol = window.location.protocol;

                        showToast('Info', 'Processing authorization...', 'info');

                        // Prefer navigating in sub-window (if not closed)
                        if (authWindow && !authWindow.closed) {
                            authWindow.location.href = localUrl.href;
                        } else {
                            // Fallback: via hidden iframe or fetch
                            const img = new Image();
                            img.src = localUrl.href;
                        }

                    } else {
                        showToast('Warning', 'Invalid callback URL', 'warning');
                    }
                } catch (err) {
                    console.error('Failed to process callback:', err);
                    showToast('Error', 'Invalid URL format', 'error');
                }
            };

            applyBtn.addEventListener('click', () => {
                processCallback(manualInput.value);
            });

            // Start timer to poll sub-window URL
            const pollTimer = setInterval(() => {
                try {
                    if (authWindow.closed) {
                        clearInterval(pollTimer);
                        return;
                    }
                    // If readable, it means we're back on same origin
                    const currentUrl = authWindow.location.href;
                    if (currentUrl && (currentUrl.includes('code=') || currentUrl.includes('token='))) {
                        processCallback(currentUrl);
                    }
                } catch (e) {
                    // Cross-origin restrictions are normal
                }
            }, 1000);
        } else {
            showToast('Error', 'Authorization window was blocked by browser', 'error');
        }
    });
    
}

/**
 * Show restart required prompt modal
 * @param {string} version - Version being updated to
 */
function showRestartRequiredModal(version) {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay restart-required-modal';
    modal.style.display = 'flex';
    
    modal.innerHTML = `
        <div class="modal-content restart-modal-content" style="max-width: 420px;">
            <div class="modal-header restart-modal-header">
                <h3><i class="fas fa-check-circle" style="color: #10b981;"></i> <span>Restart Required</span></h3>
                <button class="modal-close">&times;</button>
            </div>
            <div class="modal-body" style="text-align: center; padding: 20px;">
                <p style="font-size: 1rem; color: #374151; margin: 0;">Updated to version ${version}. Please restart the service to apply changes.</p>
            </div>
            <div class="modal-footer">
                <button class="btn restart-confirm-btn">
                    <i class="fas fa-check"></i>
                    <span>Confirm</span>
                </button>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);

    // Close button event
    const closeBtn = modal.querySelector('.modal-close');
    const confirmBtn = modal.querySelector('.restart-confirm-btn');

    const closeModal = () => {
        modal.remove();
    };

    closeBtn.addEventListener('click', closeModal);
    confirmBtn.addEventListener('click', closeModal);

    // Click overlay to close
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            closeModal();
        }
    });
}

export {
    loadProviders,
    renderProviders,
    updateProviderStatsDisplay,
    openProviderManager,
    showAuthModal,
    executeGenerateAuthUrl
};