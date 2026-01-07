// Configuration management module

import { showToast } from './utils.js';
import { handleProviderChange, handleGeminiCredsTypeChange } from './event-handlers.js';
import { loadProviders } from './provider-manager.js';

/**
 * Load configuration
 */
async function loadConfiguration() {
    try {
        const data = await window.apiClient.get('/config');

        // Basic configuration
        const apiKeyEl = document.getElementById('apiKey');
        const hostEl = document.getElementById('host');
        const portEl = document.getElementById('port');
        const modelProviderEl = document.getElementById('modelProvider');
        const systemPromptEl = document.getElementById('systemPrompt');

        if (apiKeyEl) apiKeyEl.value = data.REQUIRED_API_KEY || '';
        if (hostEl) hostEl.value = data.HOST || '127.0.0.1';
        if (portEl) portEl.value = data.SERVER_PORT || 3000;
        if (modelProviderEl) modelProviderEl.value = data.MODEL_PROVIDER || 'gemini-cli-oauth';
        if (systemPromptEl) systemPromptEl.value = data.systemPrompt || '';
        
        // Gemini CLI OAuth
        const projectIdEl = document.getElementById('projectId');
        const geminiOauthCredsBase64El = document.getElementById('geminiOauthCredsBase64');
        const geminiOauthCredsFilePathEl = document.getElementById('geminiOauthCredsFilePath');
        
        if (projectIdEl) projectIdEl.value = data.PROJECT_ID || '';
        if (geminiOauthCredsBase64El) geminiOauthCredsBase64El.value = data.GEMINI_OAUTH_CREDS_BASE64 || '';
        if (geminiOauthCredsFilePathEl) geminiOauthCredsFilePathEl.value = data.GEMINI_OAUTH_CREDS_FILE_PATH || '';
        const geminiBaseUrlEl = document.getElementById('geminiBaseUrl');
        if (geminiBaseUrlEl) geminiBaseUrlEl.value = data.GEMINI_BASE_URL || '';
        const antigravityBaseUrlDailyEl = document.getElementById('antigravityBaseUrlDaily');
        if (antigravityBaseUrlDailyEl) antigravityBaseUrlDailyEl.value = data.ANTIGRAVITY_BASE_URL_DAILY || '';
        const antigravityBaseUrlAutopushEl = document.getElementById('antigravityBaseUrlAutopush');
        if (antigravityBaseUrlAutopushEl) antigravityBaseUrlAutopushEl.value = data.ANTIGRAVITY_BASE_URL_AUTOPUSH || '';
        
        // OpenAI Custom
        const openaiApiKeyEl = document.getElementById('openaiApiKey');
        const openaiBaseUrlEl = document.getElementById('openaiBaseUrl');
        
        if (openaiApiKeyEl) openaiApiKeyEl.value = data.OPENAI_API_KEY || '';
        if (openaiBaseUrlEl) openaiBaseUrlEl.value = data.OPENAI_BASE_URL || 'https://api.openai.com/v1';
        
        // Claude Custom
        const claudeApiKeyEl = document.getElementById('claudeApiKey');
        const claudeBaseUrlEl = document.getElementById('claudeBaseUrl');
        
        if (claudeApiKeyEl) claudeApiKeyEl.value = data.CLAUDE_API_KEY || '';
        if (claudeBaseUrlEl) claudeBaseUrlEl.value = data.CLAUDE_BASE_URL || 'https://api.anthropic.com';
        
        // OpenAI Responses
        const openaiResponsesApiKeyEl = document.getElementById('openaiResponsesApiKey');
        const openaiResponsesBaseUrlEl = document.getElementById('openaiResponsesBaseUrl');
        
        if (openaiResponsesApiKeyEl) openaiResponsesApiKeyEl.value = data.OPENAI_API_KEY || '';
        if (openaiResponsesBaseUrlEl) openaiResponsesBaseUrlEl.value = data.OPENAI_BASE_URL || 'https://api.openai.com/v1';

        // Advanced configuration parameters
        const systemPromptFilePathEl = document.getElementById('systemPromptFilePath');
        const systemPromptModeEl = document.getElementById('systemPromptMode');
        const promptLogBaseNameEl = document.getElementById('promptLogBaseName');
        const promptLogModeEl = document.getElementById('promptLogMode');
        const requestMaxRetriesEl = document.getElementById('requestMaxRetries');
        const requestBaseDelayEl = document.getElementById('requestBaseDelay');
        const cronNearMinutesEl = document.getElementById('cronNearMinutes');
        const cronRefreshTokenEl = document.getElementById('cronRefreshToken');
        const providerPoolsFilePathEl = document.getElementById('providerPoolsFilePath');
        const maxErrorCountEl = document.getElementById('maxErrorCount');
        const providerFallbackChainEl = document.getElementById('providerFallbackChain');

        if (systemPromptFilePathEl) systemPromptFilePathEl.value = data.SYSTEM_PROMPT_FILE_PATH || 'configs/input_system_prompt.txt';
        if (systemPromptModeEl) systemPromptModeEl.value = data.SYSTEM_PROMPT_MODE || 'append';
        if (promptLogBaseNameEl) promptLogBaseNameEl.value = data.PROMPT_LOG_BASE_NAME || 'prompt_log';
        if (promptLogModeEl) promptLogModeEl.value = data.PROMPT_LOG_MODE || 'none';
        if (requestMaxRetriesEl) requestMaxRetriesEl.value = data.REQUEST_MAX_RETRIES || 3;
        if (requestBaseDelayEl) requestBaseDelayEl.value = data.REQUEST_BASE_DELAY || 1000;
        if (cronNearMinutesEl) cronNearMinutesEl.value = data.CRON_NEAR_MINUTES || 1;
        if (cronRefreshTokenEl) cronRefreshTokenEl.checked = data.CRON_REFRESH_TOKEN || false;
        if (providerPoolsFilePathEl) providerPoolsFilePathEl.value = data.PROVIDER_POOLS_FILE_PATH;
        if (maxErrorCountEl) maxErrorCountEl.value = data.MAX_ERROR_COUNT || 3;

        // Auto health check configuration
        const autoHealthCheckEnabledEl = document.getElementById('autoHealthCheckEnabled');
        const quickRetryIntervalSecondsEl = document.getElementById('quickRetryIntervalSeconds');
        const quickRetryMaxCountEl = document.getElementById('quickRetryMaxCount');
        const rateLimitCheckIntervalHoursEl = document.getElementById('rateLimitCheckIntervalHours');
        const standardCheckIntervalHoursEl = document.getElementById('standardCheckIntervalHours');

        if (autoHealthCheckEnabledEl) autoHealthCheckEnabledEl.checked = data.AUTO_HEALTH_CHECK_ENABLED !== false;
        if (quickRetryIntervalSecondsEl) quickRetryIntervalSecondsEl.value = data.QUICK_RETRY_INTERVAL_SECONDS || 10;
        if (quickRetryMaxCountEl) quickRetryMaxCountEl.value = data.QUICK_RETRY_MAX_COUNT || 3;
        if (rateLimitCheckIntervalHoursEl) rateLimitCheckIntervalHoursEl.value = data.RATE_LIMIT_CHECK_INTERVAL_HOURS || 3;
        if (standardCheckIntervalHoursEl) standardCheckIntervalHoursEl.value = data.STANDARD_CHECK_INTERVAL_HOURS || 3;

        // Load fallback chain configuration
        if (providerFallbackChainEl) {
            if (data.providerFallbackChain && typeof data.providerFallbackChain === 'object') {
                providerFallbackChainEl.value = JSON.stringify(data.providerFallbackChain, null, 2);
            } else {
                providerFallbackChainEl.value = '';
            }
        }

        // Trigger provider configuration display
        handleProviderChange();
        
        // Set display based on Gemini credentials type
        const geminiCredsType = data.GEMINI_OAUTH_CREDS_BASE64 ? 'base64' : 'file';
        const geminiRadio = document.querySelector(`input[name="geminiCredsType"][value="${geminiCredsType}"]`);
        if (geminiRadio) {
            geminiRadio.checked = true;
            handleGeminiCredsTypeChange({ target: geminiRadio });
        }
        
        // Check and set provider pool menu display status
        // const providerPoolsFilePath = data.PROVIDER_POOLS_FILE_PATH;
        // const providersMenuItem = document.querySelector('.nav-item[data-section="providers"]');
        // if (providerPoolsFilePath && providerPoolsFilePath.trim() !== '') {
        //     if (providersMenuItem) providersMenuItem.style.display = 'flex';
        // } else {
        //     if (providersMenuItem) providersMenuItem.style.display = 'none';
        // }
        
    } catch (error) {
        console.error('Failed to load configuration:', error);
    }
}

/**
 * Save configuration
 */
async function saveConfiguration() {
    const config = {
        REQUIRED_API_KEY: document.getElementById('apiKey')?.value || '',
        HOST: document.getElementById('host')?.value || '127.0.0.1',
        SERVER_PORT: parseInt(document.getElementById('port')?.value || 3000),
        MODEL_PROVIDER: document.getElementById('modelProvider')?.value || 'gemini-cli-oauth',
        systemPrompt: document.getElementById('systemPrompt')?.value || '',
    };

    // Get admin login password (if entered)
    const adminPassword = document.getElementById('adminPassword')?.value || '';

    // Save different configurations based on different providers
    const provider = document.getElementById('modelProvider')?.value;
    
    switch (provider) {
        case 'gemini-cli-oauth':
            config.PROJECT_ID = document.getElementById('projectId')?.value || '';
            const geminiCredsType = document.querySelector('input[name="geminiCredsType"]:checked')?.value;
            if (geminiCredsType === 'base64') {
                config.GEMINI_OAUTH_CREDS_BASE64 = document.getElementById('geminiOauthCredsBase64')?.value || '';
                config.GEMINI_OAUTH_CREDS_FILE_PATH = null;
            } else {
                config.GEMINI_OAUTH_CREDS_BASE64 = null;
                config.GEMINI_OAUTH_CREDS_FILE_PATH = document.getElementById('geminiOauthCredsFilePath')?.value || '';
            }
            config.GEMINI_BASE_URL = document.getElementById('geminiBaseUrl')?.value || null;
            break;

        case 'gemini-antigravity':
            config.ANTIGRAVITY_BASE_URL_DAILY = document.getElementById('antigravityBaseUrlDaily')?.value || null;
            config.ANTIGRAVITY_BASE_URL_AUTOPUSH = document.getElementById('antigravityBaseUrlAutopush')?.value || null;
            config.ANTIGRAVITY_OAUTH_CREDS_FILE_PATH = document.getElementById('antigravityOauthCredsFilePath')?.value || '';
            break;
            
        case 'openai-custom':
            config.OPENAI_API_KEY = document.getElementById('openaiApiKey')?.value || '';
            config.OPENAI_BASE_URL = document.getElementById('openaiBaseUrl')?.value || '';
            break;
            
        case 'claude-custom':
            config.CLAUDE_API_KEY = document.getElementById('claudeApiKey')?.value || '';
            config.CLAUDE_BASE_URL = document.getElementById('claudeBaseUrl')?.value || '';
            break;
            
        case 'openaiResponses-custom':
            config.OPENAI_API_KEY = document.getElementById('openaiResponsesApiKey')?.value || '';
            config.OPENAI_BASE_URL = document.getElementById('openaiResponsesBaseUrl')?.value || '';
            break;
    }

    // Save advanced configuration parameters
    config.SYSTEM_PROMPT_FILE_PATH = document.getElementById('systemPromptFilePath')?.value || 'configs/input_system_prompt.txt';
    config.SYSTEM_PROMPT_MODE = document.getElementById('systemPromptMode')?.value || 'append';
    config.PROMPT_LOG_BASE_NAME = document.getElementById('promptLogBaseName')?.value || '';
    config.PROMPT_LOG_MODE = document.getElementById('promptLogMode')?.value || '';
    config.REQUEST_MAX_RETRIES = parseInt(document.getElementById('requestMaxRetries')?.value || 3);
    config.REQUEST_BASE_DELAY = parseInt(document.getElementById('requestBaseDelay')?.value || 1000);
    config.CRON_NEAR_MINUTES = parseInt(document.getElementById('cronNearMinutes')?.value || 1);
    config.CRON_REFRESH_TOKEN = document.getElementById('cronRefreshToken')?.checked || false;
    config.PROVIDER_POOLS_FILE_PATH = document.getElementById('providerPoolsFilePath')?.value || '';
    config.MAX_ERROR_COUNT = parseInt(document.getElementById('maxErrorCount')?.value || 3);

    // Save auto health check configuration
    config.AUTO_HEALTH_CHECK_ENABLED = document.getElementById('autoHealthCheckEnabled')?.checked ?? true;
    config.QUICK_RETRY_INTERVAL_SECONDS = parseInt(document.getElementById('quickRetryIntervalSeconds')?.value || 10);
    config.QUICK_RETRY_MAX_COUNT = parseInt(document.getElementById('quickRetryMaxCount')?.value || 3);
    config.RATE_LIMIT_CHECK_INTERVAL_HOURS = parseFloat(document.getElementById('rateLimitCheckIntervalHours')?.value || 3);
    config.STANDARD_CHECK_INTERVAL_HOURS = parseFloat(document.getElementById('standardCheckIntervalHours')?.value || 3);

    // Save fallback chain configuration
    const fallbackChainValue = document.getElementById('providerFallbackChain')?.value?.trim() || '';
    if (fallbackChainValue) {
        try {
            config.providerFallbackChain = JSON.parse(fallbackChainValue);
        } catch (e) {
            showToast('Error', 'Fallback chain configuration format is invalid, please enter valid JSON', 'error');
            return;
        }
    } else {
        config.providerFallbackChain = {};
    }

    try {
        await window.apiClient.post('/config', config);
        
        // If new password was entered, save password separately
        if (adminPassword) {
            try {
                await window.apiClient.post('/admin-password', { password: adminPassword });
                // Clear password input field
                const adminPasswordEl = document.getElementById('adminPassword');
                if (adminPasswordEl) adminPasswordEl.value = '';
                showToast('Success', 'Password updated', 'success');
            } catch (pwdError) {
                console.error('Failed to save admin password:', pwdError);
                showToast('Error', 'Error: ' + pwdError.message, 'error');
            }
        }
        
        await window.apiClient.post('/reload-config');
        showToast('Success', 'Configuration saved', 'success');
        
        // Check if currently on provider pool management page, refresh data if so
        const providersSection = document.getElementById('providers');
        if (providersSection && providersSection.classList.contains('active')) {
            // Currently on provider pool page, refresh data
            await loadProviders();
            showToast('Success', 'Provider pool refreshed', 'success');
        }
    } catch (error) {
        console.error('Failed to save configuration:', error);
        showToast('Error', 'Error: ' + error.message, 'error');
    }
}

export {
    loadConfiguration,
    saveConfiguration
};