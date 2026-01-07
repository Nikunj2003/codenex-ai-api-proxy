/**
 * Dashboard Module
 * Handles data fetching, chart initialization, auto-refresh, and dark mode
 */

import {
    ColorPalette,
    isDarkMode,
    createThroughputChart,
    createErrorRateChart,
    createProviderLoadChart,
    createTokenUsageChart,
    createHealthTimelineChart,
    createTopModelsChart,
    updateChartTheme,
    formatNumber,
    generateTimeSeriesLabels
} from './charts.js';

import { apiClient } from './auth.js';

/**
 * Dashboard State
 */
const state = {
    charts: {
        throughput: null,
        error: null,
        providerLoad: null,
        tokenUsage: null,
        healthTimeline: null,
        topModels: null
    },
    autoRefresh: {
        enabled: true,
        interval: 30000, // 30 seconds
        timerId: null
    },
    darkMode: false,
    isLoading: false,
    lastUpdate: null,
    initialized: false,
    isIntegrated: false // true when running inside index.html
};

/**
 * Element ID prefix for integrated mode
 * In integrated mode (inside index.html), elements have 'dash' prefix
 */
function getElementId(baseId) {
    return state.isIntegrated ? `dash${baseId.charAt(0).toUpperCase() + baseId.slice(1)}` : baseId;
}

/**
 * Get element by base ID, checking both integrated and standalone IDs
 */
function getElement(baseId) {
    if (state.isIntegrated) {
        const integratedId = `dash${baseId.charAt(0).toUpperCase() + baseId.slice(1)}`;
        return document.getElementById(integratedId);
    }
    return document.getElementById(baseId);
}

/**
 * API Endpoints
 */
const API_ENDPOINTS = {
    overview: '/metrics/overview',
    requests: '/metrics/requests',
    latency: '/metrics/latency',
    errors: '/metrics/errors',
    tokens: '/metrics/tokens',
    healthTimeline: '/metrics/providers/health-timeline',
    providerLoad: '/metrics/providers/load',
    cacheStats: '/cache/stats',
    system: '/system'
};

/**
 * Initialize the dashboard
 */
async function initDashboard() {
    if (state.initialized) {
        console.log('Dashboard already initialized');
        return;
    }

    console.log('Initializing dashboard...');

    // Detect if we're running in integrated mode (inside index.html)
    state.isIntegrated = !!document.getElementById('dashTotalRequests');
    console.log('Dashboard mode:', state.isIntegrated ? 'integrated' : 'standalone');

    // In integrated mode, skip dark mode init (main app handles it)
    if (!state.isIntegrated) {
        initDarkMode();
    }

    // Initialize auto-refresh from localStorage
    initAutoRefresh();

    // Initialize all charts
    initCharts();

    // Set up event listeners
    setupEventListeners();

    // Initial data fetch
    await refreshAllData();

    // Start auto-refresh if enabled
    if (state.autoRefresh.enabled) {
        startAutoRefresh();
    }

    state.initialized = true;
    console.log('Dashboard initialized');
}

/**
 * Cleanup dashboard (for when navigating away in integrated mode)
 */
function cleanupDashboard() {
    stopAutoRefresh();

    // Destroy all charts
    Object.keys(state.charts).forEach(key => {
        if (state.charts[key]) {
            state.charts[key].destroy();
            state.charts[key] = null;
        }
    });

    state.initialized = false;
    console.log('Dashboard cleaned up');
}

/**
 * Initialize dark mode
 */
function initDarkMode() {
    const savedDarkMode = localStorage.getItem('dashboardDarkMode');
    state.darkMode = savedDarkMode === 'true';

    if (state.darkMode) {
        document.documentElement.classList.add('dark-mode');
    }

    updateDarkModeUI();
}

/**
 * Toggle dark mode
 */
function toggleDarkMode() {
    state.darkMode = !state.darkMode;
    localStorage.setItem('dashboardDarkMode', state.darkMode.toString());

    if (state.darkMode) {
        document.documentElement.classList.add('dark-mode');
    } else {
        document.documentElement.classList.remove('dark-mode');
    }

    updateDarkModeUI();
    updateAllChartsTheme();
}

/**
 * Update dark mode UI elements
 */
function updateDarkModeUI() {
    const icon = document.getElementById('darkModeIcon');
    const label = document.getElementById('darkModeLabel');

    if (state.darkMode) {
        icon.classList.remove('fa-moon');
        icon.classList.add('fa-sun');
        label.textContent = 'Light';
    } else {
        icon.classList.remove('fa-sun');
        icon.classList.add('fa-moon');
        label.textContent = 'Dark';
    }
}

/**
 * Update all charts theme
 */
function updateAllChartsTheme() {
    Object.values(state.charts).forEach(chart => {
        if (chart) {
            updateChartTheme(chart);
        }
    });
}

/**
 * Initialize auto-refresh
 */
function initAutoRefresh() {
    const savedAutoRefresh = localStorage.getItem('dashboardAutoRefresh');
    state.autoRefresh.enabled = savedAutoRefresh !== 'false';

    const toggleId = state.isIntegrated ? 'dashboardAutoRefresh' : 'autoRefreshToggle';
    const toggle = document.getElementById(toggleId);
    if (toggle) {
        toggle.checked = state.autoRefresh.enabled;
    }
}

/**
 * Toggle auto-refresh
 */
function toggleAutoRefresh() {
    state.autoRefresh.enabled = !state.autoRefresh.enabled;
    localStorage.setItem('dashboardAutoRefresh', state.autoRefresh.enabled.toString());

    if (state.autoRefresh.enabled) {
        startAutoRefresh();
    } else {
        stopAutoRefresh();
    }

    updateRefreshIndicator();
}

/**
 * Start auto-refresh timer
 */
function startAutoRefresh() {
    if (state.autoRefresh.timerId) {
        clearInterval(state.autoRefresh.timerId);
    }

    state.autoRefresh.timerId = setInterval(async () => {
        await refreshAllData();
    }, state.autoRefresh.interval);
}

/**
 * Stop auto-refresh timer
 */
function stopAutoRefresh() {
    if (state.autoRefresh.timerId) {
        clearInterval(state.autoRefresh.timerId);
        state.autoRefresh.timerId = null;
    }
}

/**
 * Update refresh indicator
 */
function updateRefreshIndicator(isLoading = false) {
    const indicatorId = state.isIntegrated ? 'dashboardRefreshIndicator' : 'refreshIndicator';
    const statusId = state.isIntegrated ? 'dashboardRefreshStatus' : 'refreshStatus';

    const indicator = document.getElementById(indicatorId);
    const statusText = document.getElementById(statusId);

    if (!indicator || !statusText) return;

    if (isLoading) {
        indicator.classList.add('active');
        statusText.textContent = 'Updating...';
    } else {
        indicator.classList.remove('active');
        if (state.lastUpdate) {
            const timeAgo = formatTimeAgo(state.lastUpdate);
            statusText.textContent = `Updated ${timeAgo}`;
        } else {
            statusText.textContent = 'Ready';
        }
    }
}

/**
 * Format time ago string
 */
function formatTimeAgo(date) {
    const seconds = Math.floor((new Date() - date) / 1000);

    if (seconds < 60) return 'just now';
    if (seconds < 120) return '1 min ago';
    if (seconds < 3600) return `${Math.floor(seconds / 60)} mins ago`;
    if (seconds < 7200) return '1 hour ago';
    return `${Math.floor(seconds / 3600)} hours ago`;
}

/**
 * Initialize all charts
 */
function initCharts() {
    const prefix = state.isIntegrated ? 'dash' : '';

    // Throughput chart
    const throughputCanvas = document.getElementById(`${prefix}ThroughputChart`);
    if (throughputCanvas) {
        state.charts.throughput = createThroughputChart(throughputCanvas);
    }

    // Error rate chart
    const errorCanvas = document.getElementById(`${prefix}ErrorChart`);
    if (errorCanvas) {
        state.charts.error = createErrorRateChart(errorCanvas);
    }

    // Provider load chart
    const providerLoadCanvas = document.getElementById(`${prefix}ProviderLoadChart`);
    if (providerLoadCanvas) {
        state.charts.providerLoad = createProviderLoadChart(providerLoadCanvas);
    }

    // Token usage chart
    const tokenUsageCanvas = document.getElementById(`${prefix}TokenUsageChart`);
    if (tokenUsageCanvas) {
        state.charts.tokenUsage = createTokenUsageChart(tokenUsageCanvas);
    }

    // Health timeline chart
    const healthTimelineCanvas = document.getElementById(`${prefix}HealthChart`);
    if (healthTimelineCanvas) {
        state.charts.healthTimeline = createHealthTimelineChart(healthTimelineCanvas);
    }

    // Top models chart
    const topModelsCanvas = document.getElementById(`${prefix}TopModelsChart`);
    if (topModelsCanvas) {
        state.charts.topModels = createTopModelsChart(topModelsCanvas);
    }
}

/**
 * Set up event listeners
 */
function setupEventListeners() {
    const prefix = state.isIntegrated ? 'dash' : '';
    const rangePrefix = state.isIntegrated ? 'dash' : '';

    // Dark mode toggle (only for standalone mode)
    if (!state.isIntegrated) {
        const darkModeToggle = document.getElementById('darkModeToggle');
        if (darkModeToggle) {
            darkModeToggle.addEventListener('click', toggleDarkMode);
        }
    }

    // Auto-refresh toggle
    const autoRefreshToggleId = state.isIntegrated ? 'dashboardAutoRefresh' : 'autoRefreshToggle';
    const autoRefreshToggle = document.getElementById(autoRefreshToggleId);
    if (autoRefreshToggle) {
        autoRefreshToggle.addEventListener('change', toggleAutoRefresh);
    }

    // Time range selectors
    const throughputTimeRange = document.getElementById(`${rangePrefix}ThroughputRange`);
    if (throughputTimeRange) {
        throughputTimeRange.addEventListener('change', async (e) => {
            await fetchRequestsData(e.target.value);
        });
    }

    const errorTimeRange = document.getElementById(`${rangePrefix}ErrorRange`);
    if (errorTimeRange) {
        errorTimeRange.addEventListener('change', async (e) => {
            await fetchErrorsData(e.target.value);
        });
    }

    const tokenTimeRange = document.getElementById(`${rangePrefix}TokenRange`);
    if (tokenTimeRange) {
        tokenTimeRange.addEventListener('change', async (e) => {
            await fetchTokensData(e.target.value);
        });
    }

    const healthTimeRange = document.getElementById(`${rangePrefix}HealthRange`);
    if (healthTimeRange) {
        healthTimeRange.addEventListener('change', async (e) => {
            await fetchHealthTimelineData(e.target.value);
        });
    }

    // Manual refresh on indicator click
    const indicatorId = state.isIntegrated ? 'dashboardRefreshIndicator' : 'refreshIndicator';
    const refreshIndicator = document.getElementById(indicatorId);
    if (refreshIndicator) {
        refreshIndicator.style.cursor = 'pointer';
        refreshIndicator.addEventListener('click', async () => {
            if (!state.isLoading) {
                await refreshAllData();
            }
        });
    }
}

/**
 * Refresh all data
 */
async function refreshAllData() {
    if (state.isLoading) return;

    state.isLoading = true;
    updateRefreshIndicator(true);

    try {
        // Fetch all data in parallel
        await Promise.allSettled([
            fetchOverviewData(),
            fetchRequestsData(),
            fetchErrorsData(),
            fetchTokensData(),
            fetchProviderLoadData(),
            fetchHealthTimelineData(),
            fetchTopModelsData(),
            fetchCacheStats(),
            fetchSystemInfo()
        ]);

        state.lastUpdate = new Date();
    } catch (error) {
        console.error('Error refreshing dashboard data:', error);
        showToast('Failed to refresh dashboard data', 'error');
    } finally {
        state.isLoading = false;
        updateRefreshIndicator(false);
    }
}

/**
 * Fetch overview data (counter cards)
 */
async function fetchOverviewData() {
    try {
        const data = await apiClient.get(API_ENDPOINTS.overview);

        if (data) {
            // Calculate total tokens from input + output
            const totalTokens = (data.totalInputTokens || 0) + (data.totalOutputTokens || 0);

            updateCounterCard('totalRequests', data.totalRequests || 0);
            updateCounterCard('successRate', `${data.successRate || 0}%`);
            updateCounterCard('avgLatency', `${data.avgLatencyMs || 0} ms`, null, true);
            updateCounterCard('activeProviders', data.activeProviders || 0);
            updateCounterCard('totalTokens', formatNumber(totalTokens));
            // Cache hit rate is fetched separately by fetchCacheStats()
        } else {
            // Show default values when no data
            updateCounterCard('totalRequests', 0);
            updateCounterCard('successRate', '0%');
            updateCounterCard('avgLatency', '0 ms', null, true);
            updateCounterCard('activeProviders', 0);
            updateCounterCard('totalTokens', formatNumber(0));
        }
    } catch (error) {
        console.error('Error fetching overview data:', error);
        // Show zeros instead of mock data
        updateCounterCard('totalRequests', 0);
        updateCounterCard('successRate', '0%');
        updateCounterCard('avgLatency', '0 ms', null, true);
        updateCounterCard('activeProviders', 0);
        updateCounterCard('totalTokens', formatNumber(0));
    }
}


/**
 * Update a counter card
 */
function updateCounterCard(id, value, trend = null, invertTrend = false) {
    // In integrated mode, element IDs have 'dash' prefix
    const prefix = state.isIntegrated ? 'dash' : '';
    const elementId = state.isIntegrated ? `dash${id.charAt(0).toUpperCase() + id.slice(1)}` : id;

    const valueEl = document.getElementById(elementId);
    if (valueEl) {
        valueEl.textContent = value;
    }

    if (trend !== null) {
        // Try to find the trend element
        const trendId = state.isIntegrated
            ? `dash${id.replace('total', '').replace('avg', '').replace('active', '')}Trend`
            : `${id.replace('total', '').replace('avg', '').replace('active', '').toLowerCase()}Trend`;

        const trendEl = document.getElementById(trendId) || document.getElementById(`${elementId}Trend`);

        if (trendEl) {
            const trendValue = Math.abs(trend);
            const isPositive = invertTrend ? trend < 0 : trend > 0;
            const isNeutral = trend === 0;

            trendEl.className = state.isIntegrated ? 'stat-trend' : 'counter-card-trend';
            if (isNeutral) {
                trendEl.classList.add('neutral');
                trendEl.innerHTML = `<i class="fas fa-minus"></i> 0%`;
            } else if (isPositive) {
                trendEl.classList.add('up');
                trendEl.innerHTML = `<i class="fas fa-arrow-up"></i> ${trendValue.toFixed(1)}%`;
            } else {
                trendEl.classList.add('down');
                trendEl.innerHTML = `<i class="fas fa-arrow-down"></i> ${trendValue.toFixed(1)}%`;
            }
        }
    }
}

/**
 * Fetch requests data for throughput chart
 */
async function fetchRequestsData(range = '24h') {
    try {
        const data = await apiClient.get(API_ENDPOINTS.requests, { range });
        console.log('[Dashboard] Requests API response:', data);

        if (data && data.data && data.data.length > 0 && state.charts.throughput) {
            // Transform API response to chart format
            const chartData = {
                labels: data.data.map(d => d.timeBucket),
                values: data.data.map(d => d.totalRequests)
            };
            console.log('[Dashboard] Throughput chart data:', chartData);
            updateThroughputChart(chartData);
        } else {
            // No data available - keep chart empty
            console.log('[Dashboard] No throughput data available');
            updateThroughputChart({ labels: [], values: [] });
        }
    } catch (error) {
        console.error('Error fetching requests data:', error);
        updateThroughputChart({ labels: [], values: [] });
    }
}

/**
 * Update throughput chart with data
 */
function updateThroughputChart(data) {
    const chart = state.charts.throughput;
    if (!chart) return;

    chart.data.labels = (data.labels || []).map(l => new Date(l));
    chart.data.datasets[0].data = data.values || [];
    chart.update('none');
}


/**
 * Fetch errors data for error rate chart
 */
async function fetchErrorsData(range = '24h') {
    try {
        const data = await apiClient.get(API_ENDPOINTS.errors, { range });
        console.log('[Dashboard] Errors API response:', data);

        if (data && data.byProvider && data.byProvider.length > 0 && state.charts.error) {
            // Transform to show error rate by provider
            const chartData = {
                labels: data.byProvider.map(p => p.providerType),
                values: data.byProvider.map(p => parseFloat(p.errorRate) || 0)
            };
            updateErrorChart(chartData);
        } else {
            // No error data - show empty chart
            console.log('[Dashboard] No error data available');
            updateErrorChart({ labels: [], values: [] });
        }
    } catch (error) {
        console.error('Error fetching errors data:', error);
        updateErrorChart({ labels: [], values: [] });
    }
}

/**
 * Update error chart with data
 */
function updateErrorChart(data) {
    const chart = state.charts.error;
    if (!chart) return;

    console.log('[Dashboard] Updating error chart with:', data);
    chart.data.labels = data.labels || [];
    chart.data.datasets[0].data = data.values || [];
    // Apply colors for each bar
    if (data.labels && data.labels.length > 0) {
        chart.data.datasets[0].backgroundColor = data.labels.map((_, i) =>
            ColorPalette.chartColors[i % ColorPalette.chartColors.length]
        );
    }
    chart.update('none');
}


/**
 * Fetch tokens data for token usage chart
 */
async function fetchTokensData(range = '24h') {
    try {
        const data = await apiClient.get(API_ENDPOINTS.tokens, { range });
        console.log('[Dashboard] Tokens API response:', data);

        if (data && data.byModel && data.byModel.length > 0 && state.charts.tokenUsage) {
            // Transform API response to chart format
            const chartData = {
                labels: data.byModel.map(m => m.model),
                datasets: [{
                    label: 'Input Tokens',
                    data: data.byModel.map(m => m.inputTokens),
                    backgroundColor: ColorPalette.chartColors[0],
                    borderRadius: 4
                }, {
                    label: 'Output Tokens',
                    data: data.byModel.map(m => m.outputTokens),
                    backgroundColor: ColorPalette.chartColors[1],
                    borderRadius: 4
                }]
            };
            updateTokenUsageChart(chartData);
        } else {
            // No data yet, show empty chart
            console.log('[Dashboard] No token data available');
            updateTokenUsageChart({ labels: [], datasets: [] });
        }
    } catch (error) {
        console.error('Error fetching tokens data:', error);
        updateTokenUsageChart({ labels: [], datasets: [] });
    }
}

/**
 * Update token usage chart with data
 */
function updateTokenUsageChart(data) {
    const chart = state.charts.tokenUsage;
    if (!chart) return;

    chart.data.labels = data.labels || [];
    chart.data.datasets = (data.datasets || []).map((ds, i) => ({
        label: ds.label,
        data: ds.data,
        backgroundColor: ColorPalette.chartColors[i % ColorPalette.chartColors.length],
        borderRadius: 4
    }));
    chart.update('none');
}


/**
 * Fetch provider load data
 */
async function fetchProviderLoadData() {
    try {
        const data = await apiClient.get(API_ENDPOINTS.providerLoad);
        console.log('[Dashboard] Provider load API response:', data);

        if (data && data.providers && data.providers.length > 0 && state.charts.providerLoad) {
            // Aggregate by providerType (API returns multiple entries per provider with different UUIDs)
            const aggregated = new Map();
            for (const provider of data.providers) {
                const type = provider.providerType || 'unknown';
                if (aggregated.has(type)) {
                    aggregated.set(type, aggregated.get(type) + provider.requestCount);
                } else {
                    aggregated.set(type, provider.requestCount);
                }
            }

            const chartData = {
                labels: Array.from(aggregated.keys()),
                values: Array.from(aggregated.values())
            };
            console.log('[Dashboard] Provider load chart data (aggregated):', chartData);
            updateProviderLoadChart(chartData);
        } else {
            // No data or empty providers array - show empty chart
            console.log('[Dashboard] No provider load data available');
            updateProviderLoadChart({ labels: [], values: [] });
        }
    } catch (error) {
        console.error('Error fetching provider load data:', error);
        // Show error state
        updateProviderLoadChart({ labels: [], values: [] });
    }
}

/**
 * Update provider load chart with data
 */
function updateProviderLoadChart(data) {
    const chart = state.charts.providerLoad;
    if (!chart) return;

    chart.data.labels = data.labels || [];
    chart.data.datasets[0].data = data.values || [];
    chart.update('none');
}


/**
 * Fetch health timeline data
 */
async function fetchHealthTimelineData(range = '24h') {
    try {
        const data = await apiClient.get(API_ENDPOINTS.healthTimeline, { range });
        console.log('[Dashboard] Health timeline API response:', data);

        if (data && state.charts.healthTimeline) {
            // Transform events into chart-compatible format
            const chartData = transformHealthEventsToChartData(data.events || []);
            updateHealthTimelineChart(chartData);
        } else {
            console.log('[Dashboard] No health timeline data available');
            updateHealthTimelineChart({ providers: [], datasets: [] });
        }
    } catch (error) {
        console.error('Error fetching health timeline data:', error);
        updateHealthTimelineChart({ providers: [], datasets: [] });
    }
}

/**
 * Transform health events into chart-compatible format
 * Groups events by provider type and counts healthy/unhealthy events
 */
function transformHealthEventsToChartData(events) {
    if (!events || events.length === 0) {
        return { providers: [], datasets: [] };
    }

    // Group events by provider type
    const providerMap = new Map();
    for (const event of events) {
        const providerType = event.providerType || 'unknown';
        if (!providerMap.has(providerType)) {
            providerMap.set(providerType, {
                healthy: 0,
                unhealthy: 0,
                total: 0
            });
        }
        const stats = providerMap.get(providerType);
        stats.total++;
        if (event.eventType === 'healthy') {
            stats.healthy++;
        } else if (event.eventType === 'unhealthy' || event.eventType === 'disabled') {
            stats.unhealthy++;
        }
    }

    const providers = Array.from(providerMap.keys());
    const healthyData = providers.map(p => providerMap.get(p).healthy);
    const unhealthyData = providers.map(p => providerMap.get(p).unhealthy);

    return {
        providers,
        datasets: [
            {
                label: 'Healthy',
                data: healthyData,
                backgroundColor: '#22c55e',
                borderRadius: 4
            },
            {
                label: 'Unhealthy',
                data: unhealthyData,
                backgroundColor: '#ef4444',
                borderRadius: 4
            }
        ]
    };
}

/**
 * Update health timeline chart with data
 */
function updateHealthTimelineChart(data) {
    const chart = state.charts.healthTimeline;
    if (!chart) return;

    chart.data.labels = data.providers || [];
    chart.data.datasets = data.datasets || [];
    chart.update('none');
}

/**
 * Fetch top models data
 */
async function fetchTopModelsData() {
    try {
        // Use error stats API which includes request counts by model
        const data = await apiClient.get(API_ENDPOINTS.errors);
        console.log('[Dashboard] Top models (error stats) API response:', data);

        if (data?.byModel && data.byModel.length > 0 && state.charts.topModels) {
            // Sort by total requests and take top 6 models
            const sortedModels = [...data.byModel]
                .sort((a, b) => b.totalRequests - a.totalRequests)
                .slice(0, 6);

            const chartData = {
                labels: sortedModels.map(m => m.model),
                values: sortedModels.map(m => m.totalRequests)
            };
            console.log('[Dashboard] Top models chart data:', chartData);
            updateTopModelsChart(chartData);
        } else {
            // No data yet
            console.log('[Dashboard] No top models data available');
            updateTopModelsChart({ labels: [], values: [] });
        }
    } catch (error) {
        console.error('Error fetching top models data:', error);
        updateTopModelsChart({ labels: [], values: [] });
    }
}

/**
 * Update top models chart with data
 */
function updateTopModelsChart(data) {
    const chart = state.charts.topModels;
    if (!chart) return;

    chart.data.labels = data.labels || [];
    chart.data.datasets[0].data = data.values || [];
    chart.update('none');
}

/**
 * Fetch cache statistics
 */
async function fetchCacheStats() {
    try {
        const data = await apiClient.get(API_ENDPOINTS.cacheStats);
        console.log('[Dashboard] Cache stats API response:', data);

        if (data && data.hitRate !== undefined) {
            // hitRate comes as "34.56%" string from API
            updateCounterCard('cacheHitRate', data.hitRate);
        } else if (data && data.hits !== undefined && data.misses !== undefined) {
            // Calculate hit rate if not provided directly
            const total = data.hits + data.misses;
            const hitRate = total > 0 ? ((data.hits / total) * 100).toFixed(2) : '0.00';
            updateCounterCard('cacheHitRate', `${hitRate}%`);
        } else {
            updateCounterCard('cacheHitRate', '0%');
        }
    } catch (error) {
        console.error('Error fetching cache stats:', error);
        updateCounterCard('cacheHitRate', '0%');
    }
}

/**
 * Fetch system information
 */
async function fetchSystemInfo() {
    try {
        const data = await apiClient.get(API_ENDPOINTS.system);
        console.log('[Dashboard] System info API response:', data);

        if (data) {
            // Update system info elements if they exist
            const uptimeEl = document.getElementById('dashUptime');
            const memoryEl = document.getElementById('dashMemory');
            const cpuEl = document.getElementById('dashCpu');
            const versionEl = document.getElementById('dashVersion');

            if (uptimeEl && data.uptime !== undefined) {
                uptimeEl.textContent = formatUptime(data.uptime);
            }
            if (memoryEl && data.memoryUsage) {
                // memoryUsage comes as "28 MB / 29 MB" string
                memoryEl.textContent = data.memoryUsage;
            }
            if (cpuEl && data.cpuUsage) {
                // cpuUsage comes as "0.7%" string
                cpuEl.textContent = data.cpuUsage.replace('%', '');
            }
            if (versionEl && data.appVersion) {
                versionEl.textContent = data.appVersion;
            }
        }
    } catch (error) {
        console.error('Error fetching system info:', error);
    }
}

/**
 * Format uptime in human-readable format
 */
function formatUptime(seconds) {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);

    if (days > 0) {
        return `${days}d ${hours}h`;
    } else if (hours > 0) {
        return `${hours}h ${minutes}m`;
    } else {
        return `${minutes}m`;
    }
}

/**
 * Show toast notification
 */
function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `
        <i class="fas fa-${type === 'error' ? 'exclamation-circle' : type === 'success' ? 'check-circle' : 'info-circle'}"></i>
        <span>${message}</span>
    `;

    container.appendChild(toast);

    // Auto remove after 3 seconds
    setTimeout(() => {
        toast.classList.add('fade-out');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

/**
 * Show loading state for a chart
 */
function showChartLoading(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const canvas = container.querySelector('canvas');
    if (canvas) {
        canvas.style.display = 'none';
    }

    const loadingEl = document.createElement('div');
    loadingEl.className = 'chart-loading';
    loadingEl.innerHTML = `
        <i class="fas fa-spinner"></i>
        <span>Loading...</span>
    `;
    container.appendChild(loadingEl);
}

/**
 * Hide loading state for a chart
 */
function hideChartLoading(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const loadingEl = container.querySelector('.chart-loading');
    if (loadingEl) {
        loadingEl.remove();
    }

    const canvas = container.querySelector('canvas');
    if (canvas) {
        canvas.style.display = 'block';
    }
}

/**
 * Show error state for a chart
 */
function showChartError(containerId, message = 'Failed to load data') {
    const container = document.getElementById(containerId);
    if (!container) return;

    hideChartLoading(containerId);

    const canvas = container.querySelector('canvas');
    if (canvas) {
        canvas.style.display = 'none';
    }

    const errorEl = document.createElement('div');
    errorEl.className = 'chart-error';
    errorEl.innerHTML = `
        <i class="fas fa-exclamation-triangle"></i>
        <span class="chart-error-message">${message}</span>
        <button class="chart-retry-btn" onclick="location.reload()">Retry</button>
    `;
    container.appendChild(errorEl);
}

// Initialize dashboard based on context
document.addEventListener('DOMContentLoaded', () => {
    // Check if we're in integrated mode (inside index.html with sidebar)
    const dashboardSection = document.getElementById('dashboard');
    const isStandalone = !dashboardSection || document.querySelector('.dashboard-container');

    if (isStandalone) {
        // Standalone mode: initialize immediately after auth
        setTimeout(initDashboard, 100);
    }
    // Integrated mode: will be initialized when section becomes visible
});

// Export for external use
export {
    state,
    initDashboard,
    cleanupDashboard,
    refreshAllData,
    toggleDarkMode,
    toggleAutoRefresh
};

console.log('Dashboard module loaded');
