// Utility functions

// Helper function to get current language - defaults to 'en-US'
function getCurrentLanguage() {
    return 'en-US';
}

/**
 * Format uptime
 * @param {number} seconds - Number of seconds
 * @returns {string} Formatted time string
 */
function formatUptime(seconds) {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    
    if (getCurrentLanguage() === 'en-US') {
        return `${days}d ${hours}h ${minutes}m ${secs}s`;
    }
    return `${days}d ${hours}h ${minutes}m ${secs}s`;
}

/**
 * HTML escape
 * @param {string} text - Text to escape
 * @returns {string} Escaped text
 */
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * Show toast notification
 * @param {string} title - Toast title (optional, legacy interface uses message)
 * @param {string} message - Toast message
 * @param {string} type - Message type (info, success, error)
 */
function showToast(title, message, type = 'info') {
    // Compatible with legacy interface (message, type)
    if (arguments.length === 2 && (message === 'success' || message === 'error' || message === 'info' || message === 'warning')) {
        type = message;
        message = title;
        const typeLabels = { success: 'Success', error: 'Error', info: 'Info', warning: 'Warning' };
        title = typeLabels[type] || 'Info';
    }

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
        <div style="font-weight: 600; margin-bottom: 4px;">${escapeHtml(title)}</div>
        <div>${escapeHtml(message)}</div>
    `;

    // Get toast container
    const toastContainer = document.getElementById('toastContainer') || document.querySelector('.toast-container');
    if (toastContainer) {
        toastContainer.appendChild(toast);

        setTimeout(() => {
            toast.remove();
        }, 3000);
    }
}

/**
 * Get field display label
 * @param {string} key - Field key
 * @returns {string} Display label
 */
function getFieldLabel(key) {
    const isEn = getCurrentLanguage() === 'en-US';
    const labelMap = {
        'customName': 'Custom Name (Optional)',
        'checkModelName': 'Check Model Name (Optional)',
        'checkHealth': 'Health Check',
        'OPENAI_API_KEY': 'OpenAI API Key',
        'OPENAI_BASE_URL': 'OpenAI Base URL',
        'CLAUDE_API_KEY': 'Claude API Key',
        'CLAUDE_BASE_URL': 'Claude Base URL',
        'PROJECT_ID': 'Project ID',
        'GEMINI_OAUTH_CREDS_FILE_PATH': 'OAuth Credentials File Path',
        'ANTIGRAVITY_OAUTH_CREDS_FILE_PATH': 'OAuth Credentials File Path',
        'GEMINI_BASE_URL': 'Gemini Base URL',
        'ANTIGRAVITY_BASE_URL_DAILY': 'Daily Base URL',
        'ANTIGRAVITY_BASE_URL_AUTOPUSH': 'Autopush Base URL'
    };
    
    return labelMap[key] || key;
}

/**
 * Get field configuration for provider type
 * @param {string} providerType - Provider type
 * @returns {Array} Field configuration array
 */
function getProviderTypeFields(providerType) {
    const isEn = getCurrentLanguage() === 'en-US';
    const fieldConfigs = {
        'openai-custom': [
            {
                id: 'OPENAI_API_KEY',
                label: 'OpenAI API Key',
                type: 'password',
                placeholder: 'sk-...'
            },
            {
                id: 'OPENAI_BASE_URL',
                label: 'OpenAI Base URL',
                type: 'text',
                placeholder: 'https://api.openai.com/v1'
            }
        ],
        'openaiResponses-custom': [
            {
                id: 'OPENAI_API_KEY',
                label: 'OpenAI API Key',
                type: 'password',
                placeholder: 'sk-...'
            },
            {
                id: 'OPENAI_BASE_URL',
                label: 'OpenAI Base URL',
                type: 'text',
                placeholder: 'https://api.openai.com/v1'
            }
        ],
        'claude-custom': [
            {
                id: 'CLAUDE_API_KEY',
                label: 'Claude API Key',
                type: 'password',
                placeholder: 'sk-ant-...'
            },
            {
                id: 'CLAUDE_BASE_URL',
                label: 'Claude Base URL',
                type: 'text',
                placeholder: 'https://api.anthropic.com'
            }
        ],
        'gemini-cli-oauth': [
            {
                id: 'PROJECT_ID',
                label: 'Project ID',
                type: 'text',
                placeholder: 'Google Cloud Project ID'
            },
            {
                id: 'GEMINI_OAUTH_CREDS_FILE_PATH',
                label: 'OAuth Credentials File Path',
                type: 'text',
                placeholder: 'e.g.: ~/.gemini/oauth_creds.json'
            },
            {
                id: 'GEMINI_BASE_URL',
                label: `Gemini Base URL <span class="optional-tag">Optional</span>`,
                type: 'text',
                placeholder: 'https://cloudcode-pa.googleapis.com'
            }
        ],
        'gemini-antigravity': [
            {
                id: 'PROJECT_ID',
                label: 'Project ID (Optional)',
                type: 'text',
                placeholder: 'Google Cloud Project ID (Leave blank for discovery)'
            },
            {
                id: 'ANTIGRAVITY_OAUTH_CREDS_FILE_PATH',
                label: 'OAuth Credentials File Path',
                type: 'text',
                placeholder: 'e.g.: ~/.antigravity/oauth_creds.json'
            },
            {
                id: 'ANTIGRAVITY_BASE_URL_DAILY',
                label: `Daily Base URL <span class="optional-tag">Optional</span>`,
                type: 'text',
                placeholder: 'https://daily-cloudcode-pa.sandbox.googleapis.com'
            },
            {
                id: 'ANTIGRAVITY_BASE_URL_AUTOPUSH',
                label: `Autopush Base URL <span class="optional-tag">Optional</span>`,
                type: 'text',
                placeholder: 'https://autopush-cloudcode-pa.sandbox.googleapis.com'
            }
        ]
    };
    
    return fieldConfigs[providerType] || [];
}

/**
 * Debug function: Get current provider statistics
 * @param {Object} providerStats - Provider statistics object
 * @returns {Object} Extended statistics information
 */
function getProviderStats(providerStats) {
    return {
        ...providerStats,
        // Add computed statistics
        successRate: providerStats.totalRequests > 0 ? 
            ((providerStats.totalRequests - providerStats.totalErrors) / providerStats.totalRequests * 100).toFixed(2) + '%' : '0%',
        avgUsagePerProvider: providerStats.activeProviders > 0 ? 
            Math.round(providerStats.totalRequests / providerStats.activeProviders) : 0,
        healthRatio: providerStats.totalAccounts > 0 ? 
            (providerStats.healthyProviders / providerStats.totalAccounts * 100).toFixed(2) + '%' : '0%'
    };
}

// Export all utility functions
export {
    formatUptime,
    escapeHtml,
    showToast,
    getFieldLabel,
    getProviderTypeFields,
    getProviderStats
};