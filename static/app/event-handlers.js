// Event listeners module

import { elements, autoScroll, setAutoScroll, clearLogs } from './constants.js';
import { showToast } from './utils.js';
import { fileUploadHandler } from './file-upload.js';

/**
 * Initialize all event listeners
 */
function initEventListeners() {
    // Restart button
    if (elements.restartBtn) {
        elements.restartBtn.addEventListener('click', handleRestart);
    }

    // Clear logs
    if (elements.clearLogsBtn) {
        elements.clearLogsBtn.addEventListener('click', () => {
            clearLogs();
            if (elements.logsContainer) {
                elements.logsContainer.innerHTML = '';
            }
            showToast('Success', 'Refresh successful', 'success');
        });
    }

    // Auto scroll toggle
    if (elements.toggleAutoScrollBtn) {
        elements.toggleAutoScrollBtn.addEventListener('click', () => {
            const newAutoScroll = !autoScroll;
            setAutoScroll(newAutoScroll);
            elements.toggleAutoScrollBtn.dataset.enabled = newAutoScroll;
            const statusText = newAutoScroll ? 'Auto Scroll: On' : 'Auto Scroll: Off';
            elements.toggleAutoScrollBtn.innerHTML = `
                <i class="fas fa-arrow-down"></i>
                <span data-i18n="${newAutoScroll ? 'logs.autoScroll.on' : 'logs.autoScroll.off'}">${statusText}</span>
            `;
        });
    }

    // Save configuration
    if (elements.saveConfigBtn) {
        elements.saveConfigBtn.addEventListener('click', saveConfiguration);
    }

    // Reset configuration
    if (elements.resetConfigBtn) {
        elements.resetConfigBtn.addEventListener('click', loadInitialData);
    }

    // Model provider switch
    if (elements.modelProvider) {
        elements.modelProvider.addEventListener('change', handleProviderChange);
    }

    // Gemini credentials type switch
    document.querySelectorAll('input[name="geminiCredsType"]').forEach(radio => {
        radio.addEventListener('change', handleGeminiCredsTypeChange);
    });

    // Password show/hide toggle
    document.querySelectorAll('.password-toggle').forEach(button => {
        button.addEventListener('click', handlePasswordToggle);
    });

    // Generate credentials button listener
    document.querySelectorAll('.generate-creds-btn').forEach(button => {
        button.addEventListener('click', handleGenerateCreds);
    });

    // Provider pool configuration listener
    // const providerPoolsInput = document.getElementById('providerPoolsFilePath');
    // if (providerPoolsInput) {
    //     providerPoolsInput.addEventListener('input', handleProviderPoolsConfigChange);
    // }

    // Logs container scroll
    if (elements.logsContainer) {
        elements.logsContainer.addEventListener('scroll', () => {
            if (autoScroll) {
                const isAtBottom = elements.logsContainer.scrollTop + elements.logsContainer.clientHeight
                    >= elements.logsContainer.scrollHeight - 5;
                if (!isAtBottom) {
                    setAutoScroll(false);
                    elements.toggleAutoScrollBtn.dataset.enabled = false;
                    elements.toggleAutoScrollBtn.innerHTML = `
                        <i class="fas fa-arrow-down"></i>
                        <span>Auto Scroll: Off</span>
                    `;
                }
            }
        });
    }
}

/**
 * Provider configuration switch handler
 */
function handleProviderChange() {
    const selectedProvider = elements.modelProvider?.value;
    if (!selectedProvider) return;

    const allProviderConfigs = document.querySelectorAll('.provider-config');

    // Hide all provider configurations
    allProviderConfigs.forEach(config => {
        config.style.display = 'none';
    });
    
    // Show currently selected provider configuration
    const targetConfig = document.querySelector(`[data-provider="${selectedProvider}"]`);
    if (targetConfig) {
        targetConfig.style.display = 'block';
    }
}

/**
 * Gemini credentials type switch
 * @param {Event} event - Event object
 */
function handleGeminiCredsTypeChange(event) {
    const selectedType = event.target.value;
    const base64Group = document.getElementById('geminiCredsBase64Group');
    const fileGroup = document.getElementById('geminiCredsFileGroup');
    
    if (selectedType === 'base64') {
        if (base64Group) base64Group.style.display = 'block';
        if (fileGroup) fileGroup.style.display = 'none';
    } else {
        if (base64Group) base64Group.style.display = 'none';
        if (fileGroup) fileGroup.style.display = 'block';
    }
}

/**
 * Password show/hide toggle handler
 * @param {Event} event - Event object
 */
function handlePasswordToggle(event) {
    const button = event.target.closest('.password-toggle');
    if (!button) return;
    
    const targetId = button.getAttribute('data-target');
    const input = document.getElementById(targetId);
    const icon = button.querySelector('i');
    
    if (!input || !icon) return;
    
    if (input.type === 'password') {
        input.type = 'text';
        icon.className = 'fas fa-eye-slash';
    } else {
        input.type = 'password';
        icon.className = 'fas fa-eye';
    }
}

/**
 * Handle generate credentials logic
 * @param {Event} event - Event object
 */
async function handleGenerateCreds(event) {
    const button = event.target.closest('.generate-creds-btn');
    if (!button) return;

    const providerType = button.getAttribute('data-provider');
    const targetInputId = button.getAttribute('data-target');

    try {
        await proceedWithAuth(providerType, targetInputId, {});
    } catch (error) {
        console.error('Failed to generate credentials:', error);
        showToast('Error', 'Authentication failed: ' + error.message, 'error');
    }
}

/**
 * Execute authentication logic
 */
async function proceedWithAuth(providerType, targetInputId, extraOptions = {}) {
    if (window.executeGenerateAuthUrl) {
        await window.executeGenerateAuthUrl(providerType, {
            targetInputId,
            ...extraOptions
        });
    } else {
        console.error('executeGenerateAuthUrl not found');
    }
}

/**
 * Provider pool configuration change handler
 * @param {Event} event - Event object
 */
function handleProviderPoolsConfigChange(event) {
    const filePath = event.target.value.trim();
    const providersMenuItem = document.querySelector('.nav-item[data-section="providers"]');

    if (filePath) {
        // Show provider pool menu
        if (providersMenuItem) providersMenuItem.style.display = 'flex';
    } else {
        // Hide provider pool menu
        if (providersMenuItem) providersMenuItem.style.display = 'none';

        // If currently on provider pool page, switch to config
        if (providersMenuItem && providersMenuItem.classList.contains('active')) {
            const configItem = document.querySelector('.nav-item[data-section="config"]');
            const configSection = document.getElementById('config');

            // Update navigation state
            document.querySelectorAll('.nav-item').forEach(nav => nav.classList.remove('active'));
            document.querySelectorAll('.section').forEach(section => section.classList.remove('active'));

            if (configItem) configItem.classList.add('active');
            if (configSection) configSection.classList.add('active');
        }
    }
}

/**
 * Password show/hide toggle handler (for password input in modals)
 * @param {HTMLElement} button - Button element
 */
function handleProviderPasswordToggle(button) {
    const targetKey = button.getAttribute('data-target');
    const input = button.parentNode.querySelector(`input[data-config-key="${targetKey}"]`);
    const icon = button.querySelector('i');
    
    if (!input || !icon) return;
    
    if (input.type === 'password') {
        input.type = 'text';
        icon.className = 'fas fa-eye-slash';
    } else {
        input.type = 'password';
        icon.className = 'fas fa-eye';
    }
}

// Data loading functions (need to be imported from main module)
let loadInitialData;
let saveConfiguration;
let reloadConfig;

// Current service mode (set by provider-manager.js)
let currentServiceMode = 'worker';

/**
 * Set current service mode
 * @param {string} mode - Service mode ('worker' or 'standalone')
 */
export function setServiceMode(mode) {
    currentServiceMode = mode;
}

/**
 * Get current service mode
 * @returns {string} Current service mode
 */
export function getServiceMode() {
    return currentServiceMode;
}

// Restart/reload service handler function
async function handleRestart() {
    try {
        // Execute different operations based on service mode
        if (currentServiceMode === 'standalone') {
            // Standalone mode: execute reload configuration
            await handleReloadConfig();
        } else {
            // Worker mode: execute restart service
            await handleRestartService();
        }
    } catch (error) {
        console.error('Operation failed:', error);
        const errorText = currentServiceMode === 'standalone' ? 'Reload failed' : 'Restart failed';
        showToast('Error', errorText + ': ' + error.message, 'error');
    }
}

/**
 * Reload configuration (standalone mode)
 */
async function handleReloadConfig() {
    // Confirm reload operation
    if (!confirm('Are you sure you want to reload the configuration?')) {
        return;
    }
    
    showToast('Info', 'Requesting reload...', 'info');
    
    // Refresh base data first
    if (loadInitialData) {
        loadInitialData();
    }
    
    // If reloadConfig function is available, also refresh configuration
    if (reloadConfig) {
        await reloadConfig();
    }
}

/**
 * Restart service (worker mode)
 */
async function handleRestartService() {
    // Confirm restart operation
    if (!confirm('Are you sure you want to restart the service?')) {
        return;
    }
    
    showToast('Info', 'Requesting restart...', 'info');
    
    const result = await window.apiClient.post('/restart-service');
    
    if (result.success) {
        showToast('Success', result.message || 'Service restart successful', 'success');
        
        // If in worker mode, service will auto restart, wait a few seconds then refresh page
        if (result.mode === 'worker') {
            setTimeout(() => {
                showToast('Info', 'Reconnecting...', 'info');
                // Refresh page after service restart
                setTimeout(() => {
                    window.location.reload();
                }, 3000);
            }, 2000);
        }
    } else {
        // Show error message
        const errorMsg = result.message || result.error?.message || 'Restart failed';
        showToast('Error', errorMsg, 'error');

        // If standalone mode, show hint
        if (result.mode === 'standalone') {
            showToast('Info', result.hint, 'warning');
        }
    }
}

export function setDataLoaders(dataLoader, configSaver) {
    loadInitialData = dataLoader;
    saveConfiguration = configSaver;
}

export function setReloadConfig(configReloader) {
    reloadConfig = configReloader;
}

export {
    initEventListeners,
    handleProviderChange,
    handleGeminiCredsTypeChange,
    handlePasswordToggle,
    handleProviderPoolsConfigChange,
    handleProviderPasswordToggle
};