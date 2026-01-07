// Usage management module

import { showToast } from './utils.js';
import { getAuthHeaders } from './auth.js';

// Helper function to get current language - defaults to 'en-US'
function getCurrentLanguage() {
    return 'en-US';
}

/**
 * Initialize usage management functionality
 */
export function initUsageManager() {
    const refreshBtn = document.getElementById('refreshUsageBtn');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', refreshUsage);
    }
    
    // Automatically load cached data on initialization
    loadUsage();
}

/**
 * Load usage data (preferably from cache)
 */
export async function loadUsage() {
    const loadingEl = document.getElementById('usageLoading');
    const errorEl = document.getElementById('usageError');
    const contentEl = document.getElementById('usageContent');
    const emptyEl = document.getElementById('usageEmpty');
    const lastUpdateEl = document.getElementById('usageLastUpdate');

    // Show loading state
    if (loadingEl) loadingEl.style.display = 'block';
    if (errorEl) errorEl.style.display = 'none';
    if (emptyEl) emptyEl.style.display = 'none';

    try {
        // Without refresh parameter, prefer reading from cache
        const response = await fetch('/api/usage', {
            method: 'GET',
            headers: getAuthHeaders()
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();

        // Hide loading state
        if (loadingEl) loadingEl.style.display = 'none';

        // Render usage data
        renderUsageData(data, contentEl);

        // Update last update time
        if (lastUpdateEl) {
            const timeStr = new Date(data.timestamp || Date.now()).toLocaleString(getCurrentLanguage());
            if (data.fromCache && data.timestamp) {
                lastUpdateEl.textContent = `Last updated (cached): ${timeStr}`;
                lastUpdateEl.setAttribute('data-i18n', 'usage.lastUpdateCache');
                lastUpdateEl.setAttribute('data-i18n-params', JSON.stringify({ time: timeStr }));
            } else {
                lastUpdateEl.textContent = `Last updated: ${timeStr}`;
                lastUpdateEl.setAttribute('data-i18n', 'usage.lastUpdate');
                lastUpdateEl.setAttribute('data-i18n-params', JSON.stringify({ time: timeStr }));
            }
        }
    } catch (error) {
        console.error('Failed to get usage data:', error);

        if (loadingEl) loadingEl.style.display = 'none';
        if (errorEl) {
            errorEl.style.display = 'block';
            const errorMsgEl = document.getElementById('usageErrorMessage');
            if (errorMsgEl) {
                errorMsgEl.textContent = error.message || 'Failed to load usage data';
            }
        }
    }
}

/**
 * Refresh usage data (force fetch latest data from server)
 */
export async function refreshUsage() {
    const loadingEl = document.getElementById('usageLoading');
    const errorEl = document.getElementById('usageError');
    const contentEl = document.getElementById('usageContent');
    const emptyEl = document.getElementById('usageEmpty');
    const lastUpdateEl = document.getElementById('usageLastUpdate');
    const refreshBtn = document.getElementById('refreshUsageBtn');

    // Show loading state
    if (loadingEl) loadingEl.style.display = 'block';
    if (errorEl) errorEl.style.display = 'none';
    if (emptyEl) emptyEl.style.display = 'none';
    if (refreshBtn) refreshBtn.disabled = true;

    try {
        // With refresh=true parameter, force refresh
        const response = await fetch('/api/usage?refresh=true', {
            method: 'GET',
            headers: getAuthHeaders()
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();

        // Hide loading state
        if (loadingEl) loadingEl.style.display = 'none';

        // Render usage data
        renderUsageData(data, contentEl);

        // Update last update time
        if (lastUpdateEl) {
            const timeStr = new Date().toLocaleString(getCurrentLanguage());
            lastUpdateEl.textContent = `Last updated: ${timeStr}`;
            lastUpdateEl.setAttribute('data-i18n', 'usage.lastUpdate');
            lastUpdateEl.setAttribute('data-i18n-params', JSON.stringify({ time: timeStr }));
        }

        showToast('Success', 'Refresh successful', 'success');
    } catch (error) {
        console.error('Failed to get usage data:', error);

        if (loadingEl) loadingEl.style.display = 'none';
        if (errorEl) {
            errorEl.style.display = 'block';
            const errorMsgEl = document.getElementById('usageErrorMessage');
            if (errorMsgEl) {
                errorMsgEl.textContent = error.message || 'Failed to load usage data';
            }
        }

        showToast('Error', 'Refresh failed: ' + error.message, 'error');
    } finally {
        if (refreshBtn) refreshBtn.disabled = false;
    }
}

/**
 * Render usage data
 * @param {Object} data - Usage data
 * @param {HTMLElement} container - Container element
 */
function renderUsageData(data, container) {
    if (!container) return;

    // Clear container
    container.innerHTML = '';

    if (!data || !data.providers || Object.keys(data.providers).length === 0) {
        container.innerHTML = `
            <div class="usage-empty">
                <i class="fas fa-chart-bar"></i>
                <p>No usage data available</p>
            </div>
        `;
        return;
    }

    // Group initialized and non-disabled instances by provider
    const groupedInstances = {};

    for (const [providerType, providerData] of Object.entries(data.providers)) {
        if (providerData.instances && providerData.instances.length > 0) {
            const validInstances = [];
            for (const instance of providerData.instances) {
                // Filter out uninitialized service instances
                if (instance.error === 'Service instance not initialized') {
                    continue;
                }
                // Filter out disabled providers
                if (instance.isDisabled) {
                    continue;
                }
                validInstances.push(instance);
            }
            if (validInstances.length > 0) {
                groupedInstances[providerType] = validInstances;
            }
        }
    }

    if (Object.keys(groupedInstances).length === 0) {
        container.innerHTML = `
            <div class="usage-empty">
                <i class="fas fa-chart-bar"></i>
                <p>No instances available</p>
            </div>
        `;
        return;
    }

    // Render by provider groups
    for (const [providerType, instances] of Object.entries(groupedInstances)) {
        const groupContainer = createProviderGroup(providerType, instances);
        container.appendChild(groupContainer);
    }
}

/**
 * Create provider group container
 * @param {string} providerType - Provider type
 * @param {Array} instances - Instance array
 * @returns {HTMLElement} Group container element
 */
function createProviderGroup(providerType, instances) {
    const groupContainer = document.createElement('div');
    groupContainer.className = 'usage-provider-group collapsed';
    
    const providerDisplayName = getProviderDisplayName(providerType);
    const providerIcon = getProviderIcon(providerType);
    const instanceCount = instances.length;
    const successCount = instances.filter(i => i.success).length;
    
    // Group header (clickable to collapse)
    const header = document.createElement('div');
    header.className = 'usage-group-header';
    header.innerHTML = `
        <div class="usage-group-title">
            <i class="fas fa-chevron-right toggle-icon"></i>
            <i class="${providerIcon} provider-icon"></i>
            <span class="provider-name">${providerDisplayName}</span>
            <span class="instance-count">${instanceCount} instances</span>
            <span class="success-count ${successCount === instanceCount ? 'all-success' : ''}">${successCount}/${instanceCount} success</span>
        </div>
    `;
    
    // Click header to toggle collapse state
    header.addEventListener('click', () => {
        groupContainer.classList.toggle('collapsed');
    });
    
    groupContainer.appendChild(header);
    
    // Group content (card grid)
    const content = document.createElement('div');
    content.className = 'usage-group-content';
    
    const gridContainer = document.createElement('div');
    gridContainer.className = 'usage-cards-grid';
    
    for (const instance of instances) {
        const instanceCard = createInstanceUsageCard(instance, providerType);
        gridContainer.appendChild(instanceCard);
    }
    
    content.appendChild(gridContainer);
    groupContainer.appendChild(content);
    
    return groupContainer;
}

/**
 * Create instance usage card
 * @param {Object} instance - Instance data
 * @param {string} providerType - Provider type
 * @returns {HTMLElement} Card element
 */
function createInstanceUsageCard(instance, providerType) {
    const card = document.createElement('div');
    card.className = `usage-instance-card ${instance.success ? 'success' : 'error'}`;

    const providerDisplayName = getProviderDisplayName(providerType);
    const providerIcon = getProviderIcon(providerType);

    // Instance header - integrating user information
    const header = document.createElement('div');
    header.className = 'usage-instance-header';
    
    const statusIcon = instance.success
        ? '<i class="fas fa-check-circle status-success"></i>'
        : '<i class="fas fa-times-circle status-error"></i>';
    
    const healthBadge = instance.isDisabled
        ? `<span class="badge badge-disabled">Disabled</span>`
        : (instance.isHealthy
            ? `<span class="badge badge-healthy">Healthy</span>`
            : `<span class="badge badge-unhealthy">Unhealthy</span>`);

    // Get user email and subscription info
    const userEmail = instance.usage?.user?.email || '';
    const subscriptionTitle = instance.usage?.subscription?.title || '';

    // User info row
    const userInfoHTML = userEmail ? `
        <div class="instance-user-info">
            <span class="user-email" title="${userEmail}"><i class="fas fa-envelope"></i> ${userEmail}</span>
            ${subscriptionTitle ? `<span class="user-subscription">${subscriptionTitle}</span>` : ''}
        </div>
    ` : '';

    header.innerHTML = `
        <div class="instance-header-top">
            <div class="instance-provider-type">
                <i class="${providerIcon}"></i>
                <span>${providerDisplayName}</span>
            </div>
            <div class="instance-status-badges">
                ${statusIcon}
                ${healthBadge}
            </div>
        </div>
        <div class="instance-name">
            <span class="instance-name-text" title="${instance.name || instance.uuid}">${instance.name || instance.uuid}</span>
        </div>
        ${userInfoHTML}
    `;
    card.appendChild(header);

    // Instance content - only show usage and expiration time
    const content = document.createElement('div');
    content.className = 'usage-instance-content';

    if (instance.error) {
        content.innerHTML = `
            <div class="usage-error-message">
                <i class="fas fa-exclamation-triangle"></i>
                <span>${instance.error}</span>
            </div>
        `;
    } else if (instance.usage) {
        content.appendChild(renderUsageDetails(instance.usage));
    }

    card.appendChild(content);
    return card;
}

/**
 * Render usage details - display total usage, breakdown and expiration time
 * @param {Object} usage - Usage data
 * @returns {HTMLElement} Details element
 */
function renderUsageDetails(usage) {
    const container = document.createElement('div');
    container.className = 'usage-details';

    // Calculate total usage
    const totalUsage = calculateTotalUsage(usage.usageBreakdown);

    // Total usage progress bar
    if (totalUsage.hasData) {
        const totalSection = document.createElement('div');
        totalSection.className = 'usage-section total-usage';
        
        const progressClass = totalUsage.percent >= 90 ? 'danger' : (totalUsage.percent >= 70 ? 'warning' : 'normal');
        
        totalSection.innerHTML = `
            <div class="total-usage-header">
                <span class="total-label"><i class="fas fa-chart-pie"></i> <span>Total Usage</span></span>
                <span class="total-value">${formatNumber(totalUsage.used)} / ${formatNumber(totalUsage.limit)}</span>
            </div>
            <div class="progress-bar ${progressClass}">
                <div class="progress-fill" style="width: ${totalUsage.percent}%"></div>
            </div>
            <div class="total-percent">${totalUsage.percent.toFixed(2)}%</div>
        `;
        container.appendChild(totalSection);
    }

    // Usage breakdown (including free trial and bonus info)
    if (usage.usageBreakdown && usage.usageBreakdown.length > 0) {
        const breakdownSection = document.createElement('div');
        breakdownSection.className = 'usage-section usage-breakdown-compact';
        
        let breakdownHTML = '';
        
        for (const breakdown of usage.usageBreakdown) {
            breakdownHTML += createUsageBreakdownHTML(breakdown);
        }
        
        breakdownSection.innerHTML = breakdownHTML;
        container.appendChild(breakdownSection);
    }

    return container;
}

/**
 * Create usage breakdown HTML (compact version)
 * @param {Object} breakdown - Usage breakdown data
 * @returns {string} HTML string
 */
function createUsageBreakdownHTML(breakdown) {
    const usagePercent = breakdown.usageLimit > 0
        ? Math.min(100, (breakdown.currentUsage / breakdown.usageLimit) * 100)
        : 0;
    
    const progressClass = usagePercent >= 90 ? 'danger' : (usagePercent >= 70 ? 'warning' : 'normal');

    let html = `
        <div class="breakdown-item-compact">
            <div class="breakdown-header-compact">
                <span class="breakdown-name">${breakdown.displayName || breakdown.resourceType}</span>
                <span class="breakdown-usage">${formatNumber(breakdown.currentUsage)} / ${formatNumber(breakdown.usageLimit)}</span>
            </div>
            <div class="progress-bar-small ${progressClass}">
                <div class="progress-fill" style="width: ${usagePercent}%"></div>
            </div>
    `;

    // Free trial info
    if (breakdown.freeTrial && breakdown.freeTrial.status === 'ACTIVE') {
        html += `
            <div class="extra-usage-info free-trial">
                <span class="extra-label"><i class="fas fa-gift"></i> <span>Free Trial</span></span>
                <span class="extra-value">${formatNumber(breakdown.freeTrial.currentUsage)} / ${formatNumber(breakdown.freeTrial.usageLimit)}</span>
                <span class="extra-expires">Expires: ${formatDate(breakdown.freeTrial.expiresAt)}</span>
            </div>
        `;
    }

    // Bonus info
    if (breakdown.bonuses && breakdown.bonuses.length > 0) {
        for (const bonus of breakdown.bonuses) {
            if (bonus.status === 'ACTIVE') {
                html += `
                    <div class="extra-usage-info bonus">
                        <span class="extra-label"><i class="fas fa-star"></i> ${bonus.displayName || bonus.code}</span>
                        <span class="extra-value">${formatNumber(bonus.currentUsage)} / ${formatNumber(bonus.usageLimit)}</span>
                        <span class="extra-expires">Expires: ${formatDate(bonus.expiresAt)}</span>
                    </div>
                `;
            }
        }
    }

    html += '</div>';
    return html;
}

/**
 * Calculate total usage (including base usage, free trial and bonuses)
 * @param {Array} usageBreakdown - Usage breakdown array
 * @returns {Object} Total usage info
 */
function calculateTotalUsage(usageBreakdown) {
    if (!usageBreakdown || usageBreakdown.length === 0) {
        return { hasData: false, used: 0, limit: 0, percent: 0 };
    }

    let totalUsed = 0;
    let totalLimit = 0;

    for (const breakdown of usageBreakdown) {
        // Base usage
        totalUsed += breakdown.currentUsage || 0;
        totalLimit += breakdown.usageLimit || 0;

        // Free trial usage
        if (breakdown.freeTrial && breakdown.freeTrial.status === 'ACTIVE') {
            totalUsed += breakdown.freeTrial.currentUsage || 0;
            totalLimit += breakdown.freeTrial.usageLimit || 0;
        }

        // Bonus usage
        if (breakdown.bonuses && breakdown.bonuses.length > 0) {
            for (const bonus of breakdown.bonuses) {
                if (bonus.status === 'ACTIVE') {
                    totalUsed += bonus.currentUsage || 0;
                    totalLimit += bonus.usageLimit || 0;
                }
            }
        }
    }

    const percent = totalLimit > 0 ? Math.min(100, (totalUsed / totalLimit) * 100) : 0;

    return {
        hasData: true,
        used: totalUsed,
        limit: totalLimit,
        percent: percent
    };
}

/**
 * Get provider display name
 * @param {string} providerType - Provider type
 * @returns {string} Display name
 */
function getProviderDisplayName(providerType) {
    const names = {
        'gemini-cli-oauth': 'Gemini CLI OAuth',
        'gemini-antigravity': 'Gemini Antigravity',
        'openai-custom': 'OpenAI Custom',
        'claude-custom': 'Claude Custom',
        'openaiResponses-custom': 'OpenAI Responses'
    };
    return names[providerType] || providerType;
}

/**
 * Get provider icon
 * @param {string} providerType - Provider type
 * @returns {string} Icon class name
 */
function getProviderIcon(providerType) {
    const icons = {
        'gemini-cli-oauth': 'fas fa-gem',
        'gemini-antigravity': 'fas fa-rocket',
        'openai-custom': 'fas fa-robot',
        'claude-custom': 'fas fa-brain',
        'openaiResponses-custom': 'fas fa-comments'
    };
    return icons[providerType] || 'fas fa-server';
}


/**
 * Format number (round up to two decimal places)
 * @param {number} num - Number
 * @returns {string} Formatted number
 */
function formatNumber(num) {
    if (num === null || num === undefined) return '0.00';
    // Round up to two decimal places
    const rounded = Math.ceil(num * 100) / 100;
    return rounded.toFixed(2);
}

/**
 * Format date
 * @param {string} dateStr - ISO date string
 * @returns {string} Formatted date
 */
function formatDate(dateStr) {
    if (!dateStr) return '--';
    try {
        const date = new Date(dateStr);
        return date.toLocaleString(getCurrentLanguage(), {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        });
    } catch (e) {
        return dateStr;
    }
}