// Global variables
let eventSource = null;
let autoScroll = true;
let logs = [];

// Provider statistics global variable
let providerStats = {
    totalRequests: 0,
    totalErrors: 0,
    activeProviders: 0,
    healthyProviders: 0,
    totalAccounts: 0,
    lastUpdateTime: null,
    providerTypeStats: {} // Detailed statistics by type
};

// DOM elements
const elements = {
    serverStatus: document.getElementById('serverStatus'),
    restartBtn: document.getElementById('restartBtn'),
    sections: document.querySelectorAll('.section'),
    navItems: document.querySelectorAll('.nav-item'),
    logsContainer: document.getElementById('logsContainer'),
    clearLogsBtn: document.getElementById('clearLogs'),
    toggleAutoScrollBtn: document.getElementById('toggleAutoScroll'),
    saveConfigBtn: document.getElementById('saveConfig'),
    resetConfigBtn: document.getElementById('resetConfig'),
    toastContainer: document.getElementById('toastContainer'),
    modelProvider: document.getElementById('modelProvider'),
};

// Periodic refresh intervals
const REFRESH_INTERVALS = {
    SYSTEM_INFO: 10000
};

// Export all constants
export {
    eventSource,
    autoScroll,
    logs,
    providerStats,
    elements,
    REFRESH_INTERVALS
};

// Update functions
export function setEventSource(source) {
    eventSource = source;
}

export function setAutoScroll(value) {
    autoScroll = value;
}

export function addLog(log) {
    logs.push(log);
}

export function clearLogs() {
    logs = [];
}

export function updateProviderStats(newStats) {
    providerStats = { ...providerStats, ...newStats };
}