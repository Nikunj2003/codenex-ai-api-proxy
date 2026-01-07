// Server-Sent Events handling module

import { eventSource, setEventSource, elements, addLog, autoScroll } from './constants.js';

/**
 * Server-Sent Events initialization
 */
function initEventStream() {
    if (eventSource) {
        eventSource.close();
    }

    const newEventSource = new EventSource('/api/events');
    setEventSource(newEventSource);

    newEventSource.onopen = () => {
        updateServerStatus(true);
        console.log('EventStream connected');
    };

    newEventSource.onerror = () => {
        updateServerStatus(false);
        console.log('EventStream disconnected');
    };

    newEventSource.addEventListener('log', (event) => {
        const data = JSON.parse(event.data);
        addLogEntry(data);
    });

    newEventSource.addEventListener('provider', (event) => {
        const data = JSON.parse(event.data);
        updateProviderStatus(data);
    });

    newEventSource.addEventListener('oauth_success', (event) => {
        const data = JSON.parse(event.data);
        showToast('Success', `Success (${data.provider})`, 'success');
        // Dispatch custom event so other modules (like credential generation logic) can receive details
        window.dispatchEvent(new CustomEvent('oauth_success_event', { detail: data }));
    });

    newEventSource.addEventListener('provider_update', (event) => {
        const data = JSON.parse(event.data);
        handleProviderUpdate(data);
    });

    newEventSource.addEventListener('config_update', (event) => {
        const data = JSON.parse(event.data);
        handleConfigUpdate(data);
    });
}

/**
 * Add log entry
 * @param {Object} logData - Log data
 */
function addLogEntry(logData) {
    addLog(logData);
    
    if (!elements.logsContainer) return;
    
    const logEntry = document.createElement('div');
    logEntry.className = 'log-entry';

    const time = new Date(logData.timestamp).toLocaleTimeString();
    const levelClass = `log-level-${logData.level}`;

    logEntry.innerHTML = `
        <span class="log-time">[${time}]</span>
        <span class="${levelClass}">[${logData.level.toUpperCase()}]</span>
        <span class="log-message">${escapeHtml(logData.message)}</span>
    `;

    elements.logsContainer.appendChild(logEntry);

    if (autoScroll) {
        elements.logsContainer.scrollTop = elements.logsContainer.scrollHeight;
    }
}

/**
 * Update server status
 * @param {boolean} connected - Connection status
 */
function updateServerStatus(connected) {
    if (!elements.serverStatus) return;
    
    const statusBadge = elements.serverStatus;
    const icon = statusBadge.querySelector('i');
    const text = statusBadge.querySelector('span') || statusBadge.childNodes[1];

    if (connected) {
        statusBadge.classList.remove('error');
        icon.style.color = 'var(--success-color)';
        statusBadge.innerHTML = `<i class="fas fa-circle"></i> <span>Connected</span>`;
    } else {
        statusBadge.classList.add('error');
        icon.style.color = 'var(--danger-color)';
        statusBadge.innerHTML = `<i class="fas fa-circle"></i> <span>Disconnected</span>`;
    }
}

/**
 * Update provider status
 * @param {Object} data - Provider data
 */
function updateProviderStatus(data) {
    // Trigger reload of provider list
    if (typeof loadProviders === 'function') {
        loadProviders();
    }
}

/**
 * Handle provider update event
 * @param {Object} data - Update data
 */
function handleProviderUpdate(data) {
    if (data.action && data.providerType) {
        // If the currently open modal is for the provider type of the update event, refresh that modal
        const modal = document.querySelector('.provider-modal');
        if (modal && modal.getAttribute('data-provider-type') === data.providerType) {
            if (typeof refreshProviderConfig === 'function') {
                refreshProviderConfig(data.providerType);
            }
        } else {
            // Otherwise update the main interface provider list
            if (typeof loadProviders === 'function') {
                loadProviders();
            }
        }
    }
}

// Import utility functions
import { escapeHtml, showToast } from './utils.js';

// Functions to be imported from other modules
let loadProviders;
let refreshProviderConfig;
let loadConfigList;

export function setProviderLoaders(providerLoader, providerRefresher) {
    loadProviders = providerLoader;
    refreshProviderConfig = providerRefresher;
}

export function setConfigLoaders(configLoader) {
    loadConfigList = configLoader;
}

/**
 * Handle config update event
 * @param {Object} data - Update data
 */
function handleConfigUpdate(data) {
    console.log('[ConfigUpdate] Received config update event:', data);

    // Handle based on action type
    switch (data.action) {
        case 'delete':
            // File delete event, directly refresh config file list
            if (loadConfigList) {
                loadConfigList();
                console.log('[ConfigUpdate] Config file list refreshed (file deleted)');
            }
            break;

        case 'add':
        case 'update':
            // File add or update event, refresh config file list
            if (loadConfigList) {
                loadConfigList();
                console.log('[ConfigUpdate] Config file list refreshed (file updated)');
            }
            break;

        default:
            // Unknown action type, also refresh list to ensure sync
            if (loadConfigList) {
                loadConfigList();
                console.log('[ConfigUpdate] Config file list refreshed (default)');
            }
            break;
    }
}

export {
    initEventStream,
    addLogEntry,
    updateServerStatus,
    updateProviderStatus,
    handleProviderUpdate
};
