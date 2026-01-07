// Main application entry file - modular version

// Import all modules
import {
    providerStats,
    REFRESH_INTERVALS
} from './constants.js';

import {
    showToast,
    getProviderStats
} from './utils.js';

import {
    initFileUpload,
    fileUploadHandler
} from './file-upload.js';

import { 
    initNavigation 
} from './navigation.js';

import {
    initEventListeners,
    setDataLoaders,
    setReloadConfig
} from './event-handlers.js';

import {
    initEventStream,
    setProviderLoaders,
    setConfigLoaders
} from './event-stream.js';

import {
    loadProviders,
    openProviderManager,
    showAuthModal,
    executeGenerateAuthUrl
} from './provider-manager.js';

import {
    loadConfiguration,
    saveConfiguration
} from './config-manager.js';

import {
    showProviderManagerModal,
    refreshProviderConfig
} from './modal.js';

import {
    initUploadConfigManager,
    loadConfigList,
    viewConfig,
    deleteConfig,
    closeConfigModal,
    copyConfigContent,
    reloadConfig
} from './upload-config-manager.js';

import {
    initUsageManager,
    refreshUsage
} from './usage-manager.js';

import {
    initImageZoom
} from './image-zoom.js';

/**
 * Load initial data
 */
function loadInitialData() {
    loadProviders();
    loadConfiguration();
}

/**
 * Initialize application
 */
function initApp() {
    // Set data loaders
    setDataLoaders(loadInitialData, saveConfiguration);
    
    // Set reloadConfig function
    setReloadConfig(reloadConfig);
    
    // Set provider loaders
    setProviderLoaders(loadProviders, refreshProviderConfig);
    
    // Set configuration loaders
    setConfigLoaders(loadConfigList);
    
    // Initialize each module
    initNavigation();
    initEventListeners();
    initEventStream();
    initFileUpload(); // Initialize file upload feature
    initUploadConfigManager(); // Initialize configuration management feature
    initUsageManager(); // Initialize usage management feature
    initImageZoom(); // Initialize image zoom feature
    loadInitialData();

    // Show welcome message
    showToast('Success', 'Welcome', 'success');

    // Periodically refresh provider info
    setInterval(() => {
        loadProviders();

        if (providerStats.activeProviders > 0) {
            const stats = getProviderStats(providerStats);
            console.log('=== Provider Statistics Report ===');
            console.log(`Active providers: ${stats.activeProviders}`);
            console.log(`Healthy providers: ${stats.healthyProviders} (${stats.healthRatio})`);
            console.log(`Total accounts: ${stats.totalAccounts}`);
            console.log(`Total requests: ${stats.totalRequests}`);
            console.log(`Total errors: ${stats.totalErrors}`);
            console.log(`Success rate: ${stats.successRate}`);
            console.log(`Average requests per provider: ${stats.avgUsagePerProvider}`);
            console.log('==================================');
        }
    }, REFRESH_INTERVALS.SYSTEM_INFO);

}

// Initialize application after DOM loads
document.addEventListener('DOMContentLoaded', initApp);

// Export global functions for other modules to use
window.loadProviders = loadProviders;
window.openProviderManager = openProviderManager;
window.showProviderManagerModal = showProviderManagerModal;
window.refreshProviderConfig = refreshProviderConfig;
window.fileUploadHandler = fileUploadHandler;
window.showAuthModal = showAuthModal;
window.executeGenerateAuthUrl = executeGenerateAuthUrl;

// Configuration management related global functions
window.viewConfig = viewConfig;
window.deleteConfig = deleteConfig;
window.loadConfigList = loadConfigList;
window.closeConfigModal = closeConfigModal;
window.copyConfigContent = copyConfigContent;
window.reloadConfig = reloadConfig;

// Usage management related global functions
window.refreshUsage = refreshUsage;

// Export debug functions
window.getProviderStats = () => getProviderStats(providerStats);

console.log('CODENEX-AI-PROXY-API Management Console loaded - Modular version');
