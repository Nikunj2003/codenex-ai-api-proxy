/**
 * Chart.js Configuration Utilities
 * Provides common chart options, color palettes, and factory functions
 */

// Color Palette matching the existing UI theme
const ColorPalette = {
    // Primary colors
    primary: '#059669',
    secondary: '#10b981',
    success: '#10b981',
    danger: '#ef4444',
    warning: '#f59e0b',
    info: '#3b82f6',
    purple: '#7c3aed',

    // Chart-specific colors (vibrant for data visualization)
    chartColors: [
        '#059669', // Primary green
        '#3b82f6', // Blue
        '#f59e0b', // Amber
        '#7c3aed', // Purple
        '#ef4444', // Red
        '#06b6d4', // Cyan
        '#ec4899', // Pink
        '#84cc16', // Lime
        '#f97316', // Orange
        '#6366f1', // Indigo
    ],

    // Gradient colors for area charts
    gradients: {
        primary: {
            start: 'rgba(5, 150, 105, 0.3)',
            end: 'rgba(5, 150, 105, 0.01)'
        },
        danger: {
            start: 'rgba(239, 68, 68, 0.3)',
            end: 'rgba(239, 68, 68, 0.01)'
        },
        info: {
            start: 'rgba(59, 130, 246, 0.3)',
            end: 'rgba(59, 130, 246, 0.01)'
        }
    },

    // Health status colors
    health: {
        healthy: '#10b981',
        unhealthy: '#ef4444',
        degraded: '#f59e0b',
        unknown: '#9ca3af'
    },

    // Text colors
    text: {
        primary: '#111827',
        secondary: '#6b7280',
        light: '#9ca3af'
    },

    // Grid and border colors
    grid: {
        light: 'rgba(0, 0, 0, 0.05)',
        dark: 'rgba(255, 255, 255, 0.1)'
    },
    border: {
        light: '#e5e7eb',
        dark: '#4b5563'
    }
};

// Dark mode color overrides
const DarkModeColors = {
    text: {
        primary: '#f9fafb',
        secondary: '#9ca3af',
        light: '#6b7280'
    },
    grid: 'rgba(255, 255, 255, 0.1)',
    border: '#4b5563'
};

/**
 * Get current theme mode
 */
function isDarkMode() {
    return document.documentElement.classList.contains('dark-mode');
}

/**
 * Get theme-aware colors
 */
function getThemeColors() {
    const dark = isDarkMode();
    return {
        text: dark ? DarkModeColors.text : ColorPalette.text,
        grid: dark ? DarkModeColors.grid : ColorPalette.grid.light,
        border: dark ? DarkModeColors.border : ColorPalette.border.light
    };
}

/**
 * Common chart options
 */
function getCommonOptions(options = {}) {
    const themeColors = getThemeColors();

    return {
        responsive: true,
        maintainAspectRatio: false,
        animation: {
            duration: 750,
            easing: 'easeInOutQuart'
        },
        interaction: {
            intersect: false,
            mode: 'index'
        },
        plugins: {
            legend: {
                display: options.showLegend !== false,
                position: options.legendPosition || 'top',
                labels: {
                    color: themeColors.text.primary,
                    usePointStyle: true,
                    pointStyle: 'circle',
                    padding: 15,
                    font: {
                        family: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
                        size: 12,
                        weight: '500'
                    }
                }
            },
            tooltip: {
                enabled: true,
                backgroundColor: isDarkMode() ? 'rgba(31, 41, 55, 0.95)' : 'rgba(255, 255, 255, 0.95)',
                titleColor: themeColors.text.primary,
                bodyColor: themeColors.text.secondary,
                borderColor: themeColors.border,
                borderWidth: 1,
                cornerRadius: 8,
                padding: 12,
                displayColors: true,
                usePointStyle: true,
                titleFont: {
                    size: 13,
                    weight: '600'
                },
                bodyFont: {
                    size: 12
                },
                callbacks: options.tooltipCallbacks || {}
            }
        },
        scales: options.scales || {}
    };
}

/**
 * Get line chart specific options
 */
function getLineChartOptions(options = {}) {
    const themeColors = getThemeColors();

    return {
        ...getCommonOptions(options),
        scales: {
            x: {
                type: 'time',
                time: {
                    unit: options.timeUnit || 'hour',
                    displayFormats: {
                        minute: 'HH:mm',
                        hour: 'HH:mm',
                        day: 'MMM d',
                        week: 'MMM d'
                    }
                },
                grid: {
                    display: false
                },
                ticks: {
                    color: themeColors.text.secondary,
                    font: { size: 11 },
                    maxRotation: 0
                },
                border: {
                    display: false
                }
            },
            y: {
                beginAtZero: true,
                grid: {
                    color: themeColors.grid,
                    drawBorder: false
                },
                ticks: {
                    color: themeColors.text.secondary,
                    font: { size: 11 },
                    padding: 8,
                    callback: options.yAxisCallback || null
                },
                border: {
                    display: false
                }
            }
        }
    };
}

/**
 * Get bar chart specific options
 */
function getBarChartOptions(options = {}) {
    const themeColors = getThemeColors();
    const isHorizontal = options.horizontal === true;
    const baseOptions = getCommonOptions(options);

    return {
        ...baseOptions,
        // Override interaction for bar charts - only show tooltip for hovered bar
        interaction: {
            intersect: true,
            mode: 'nearest'
        },
        indexAxis: isHorizontal ? 'y' : 'x',
        plugins: {
            ...baseOptions.plugins,
            tooltip: {
                ...baseOptions.plugins.tooltip,
                callbacks: options.tooltipCallbacks || {}
            }
        },
        scales: {
            x: {
                stacked: options.stacked || false,
                grid: {
                    display: isHorizontal,
                    color: themeColors.grid,
                    drawBorder: false
                },
                ticks: {
                    color: themeColors.text.secondary,
                    font: { size: 11 },
                    callback: isHorizontal ? (options.xAxisCallback || null) : null
                },
                border: {
                    display: false
                }
            },
            y: {
                stacked: options.stacked || false,
                beginAtZero: true,
                grid: {
                    display: !isHorizontal,
                    color: themeColors.grid,
                    drawBorder: false
                },
                ticks: {
                    color: themeColors.text.secondary,
                    font: { size: 11 },
                    padding: 8,
                    callback: !isHorizontal ? (options.yAxisCallback || null) : null
                },
                border: {
                    display: false
                }
            }
        }
    };
}

/**
 * Get pie/doughnut chart specific options
 */
function getPieChartOptions(options = {}) {
    const themeColors = getThemeColors();
    const baseOptions = getCommonOptions({ ...options, showLegend: true, legendPosition: 'right' });

    return {
        ...baseOptions,
        // Override interaction for pie/doughnut - only show tooltip for hovered segment
        interaction: {
            intersect: true,
            mode: 'nearest'
        },
        cutout: options.doughnut ? '60%' : 0,
        plugins: {
            ...baseOptions.plugins,
            legend: {
                position: 'right',
                labels: {
                    color: themeColors.text.primary,
                    usePointStyle: true,
                    pointStyle: 'circle',
                    padding: 15,
                    font: {
                        family: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
                        size: 12,
                        weight: '500'
                    },
                    generateLabels: options.generateLabels || null
                }
            },
            tooltip: {
                ...baseOptions.plugins.tooltip,
                callbacks: options.tooltipCallbacks || {}
            }
        }
    };
}

/**
 * Create gradient for area charts
 */
function createGradient(ctx, colorType = 'primary') {
    const gradient = ctx.createLinearGradient(0, 0, 0, ctx.canvas.height);
    const colors = ColorPalette.gradients[colorType] || ColorPalette.gradients.primary;
    gradient.addColorStop(0, colors.start);
    gradient.addColorStop(1, colors.end);
    return gradient;
}

/**
 * Chart Factory Functions
 */

/**
 * Create a throughput line chart
 */
function createThroughputChart(canvas, data = null) {
    const ctx = canvas.getContext('2d');

    const chartData = data || {
        labels: [],
        datasets: [{
            label: 'Requests/min',
            data: [],
            borderColor: ColorPalette.primary,
            backgroundColor: createGradient(ctx, 'primary'),
            fill: true,
            tension: 0.4,
            pointRadius: 0,
            pointHoverRadius: 4,
            pointHoverBackgroundColor: ColorPalette.primary,
            pointHoverBorderColor: '#fff',
            pointHoverBorderWidth: 2
        }]
    };

    const options = getLineChartOptions({
        tooltipCallbacks: {
            label: (context) => `${context.dataset.label}: ${context.parsed.y.toLocaleString()} req/min`
        }
    });

    return new Chart(ctx, {
        type: 'line',
        data: chartData,
        options: options
    });
}

/**
 * Create an error rate bar chart (by provider)
 */
function createErrorRateChart(canvas, data = null) {
    const ctx = canvas.getContext('2d');

    const chartData = data || {
        labels: [],
        datasets: [{
            label: 'Error Rate',
            data: [],
            backgroundColor: ColorPalette.danger,
            borderRadius: 4,
            barThickness: 20
        }]
    };

    const options = getBarChartOptions({
        horizontal: false,
        showLegend: false,
        yAxisCallback: (value) => `${value}%`,
        tooltipCallbacks: {
            title: (context) => context[0]?.label || '',
            label: (context) => `Error Rate: ${context.parsed.y.toFixed(2)}%`
        }
    });

    return new Chart(ctx, {
        type: 'bar',
        data: chartData,
        options: options
    });
}

/**
 * Create a provider load pie chart
 */
function createProviderLoadChart(canvas, data = null) {
    const ctx = canvas.getContext('2d');

    const chartData = data || {
        labels: [],
        datasets: [{
            data: [],
            backgroundColor: ColorPalette.chartColors,
            borderColor: isDarkMode() ? '#1f2937' : '#ffffff',
            borderWidth: 2,
            hoverOffset: 8
        }]
    };

    const options = getPieChartOptions({
        doughnut: true,
        tooltipCallbacks: {
            title: (context) => context[0]?.label || 'Provider',
            label: (context) => {
                const total = context.dataset.data.reduce((a, b) => a + b, 0);
                const value = context.parsed || 0;
                const percentage = total > 0 ? ((value / total) * 100).toFixed(1) : '0.0';
                return `Requests: ${value.toLocaleString()} (${percentage}%)`;
            }
        }
    });

    return new Chart(ctx, {
        type: 'doughnut',
        data: chartData,
        options: options
    });
}

/**
 * Create a token usage stacked bar chart
 */
function createTokenUsageChart(canvas, data = null) {
    const ctx = canvas.getContext('2d');

    const chartData = data || {
        labels: [],
        datasets: []
    };

    const options = getBarChartOptions({
        stacked: true,
        yAxisCallback: (value) => {
            if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
            if (value >= 1000) return `${(value / 1000).toFixed(1)}K`;
            return value;
        },
        tooltipCallbacks: {
            label: (context) => `${context.dataset.label}: ${context.parsed.y.toLocaleString()} tokens`
        }
    });

    return new Chart(ctx, {
        type: 'bar',
        data: chartData,
        options: options
    });
}

/**
 * Create a provider health timeline chart (stacked bar by provider)
 */
function createHealthTimelineChart(canvas, data = null) {
    const ctx = canvas.getContext('2d');

    // Health timeline uses a stacked bar chart showing healthy/unhealthy event counts per provider
    const chartData = data || {
        labels: [],
        datasets: []
    };

    const options = getBarChartOptions({
        horizontal: true,
        stacked: true,
        showLegend: true,
        legendPosition: 'top',
        tooltipCallbacks: {
            title: (context) => context[0]?.label || '',
            label: (context) => `${context.dataset.label}: ${context.parsed.x} events`
        }
    });

    return new Chart(ctx, {
        type: 'bar',
        data: chartData,
        options: options
    });
}

/**
 * Create a top models horizontal bar chart
 */
function createTopModelsChart(canvas, data = null) {
    const ctx = canvas.getContext('2d');

    const chartData = data || {
        labels: [],
        datasets: [{
            label: 'Requests',
            data: [],
            backgroundColor: ColorPalette.chartColors,
            borderRadius: 4,
            barThickness: 24
        }]
    };

    const options = getBarChartOptions({
        horizontal: true,
        showLegend: false,
        xAxisCallback: (value) => {
            if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
            if (value >= 1000) return `${(value / 1000).toFixed(1)}K`;
            return value;
        },
        tooltipCallbacks: {
            title: (context) => context[0]?.label || 'Model',
            label: (context) => `Requests: ${(context.parsed.x || 0).toLocaleString()}`
        }
    });

    return new Chart(ctx, {
        type: 'bar',
        data: chartData,
        options: options
    });
}

/**
 * Update chart theme colors (call when dark mode toggles)
 */
function updateChartTheme(chart) {
    if (!chart) return;

    const themeColors = getThemeColors();

    // Update scales
    if (chart.options.scales) {
        Object.keys(chart.options.scales).forEach(scaleKey => {
            const scale = chart.options.scales[scaleKey];
            if (scale.ticks) {
                scale.ticks.color = themeColors.text.secondary;
            }
            if (scale.grid) {
                scale.grid.color = themeColors.grid;
            }
        });
    }

    // Update legend
    if (chart.options.plugins?.legend?.labels) {
        chart.options.plugins.legend.labels.color = themeColors.text.primary;
    }

    // Update tooltip
    if (chart.options.plugins?.tooltip) {
        chart.options.plugins.tooltip.backgroundColor = isDarkMode() ? 'rgba(31, 41, 55, 0.95)' : 'rgba(255, 255, 255, 0.95)';
        chart.options.plugins.tooltip.titleColor = themeColors.text.primary;
        chart.options.plugins.tooltip.bodyColor = themeColors.text.secondary;
        chart.options.plugins.tooltip.borderColor = themeColors.border;
    }

    // Update pie/doughnut border colors
    if (chart.config.type === 'doughnut' || chart.config.type === 'pie') {
        chart.data.datasets.forEach(dataset => {
            dataset.borderColor = isDarkMode() ? '#1f2937' : '#ffffff';
        });
    }

    chart.update('none');
}

/**
 * Format number with appropriate suffix (K, M, B)
 */
function formatNumber(num) {
    if (num >= 1e9) return (num / 1e9).toFixed(1) + 'B';
    if (num >= 1e6) return (num / 1e6).toFixed(1) + 'M';
    if (num >= 1e3) return (num / 1e3).toFixed(1) + 'K';
    return num.toString();
}

/**
 * Format duration in milliseconds to human readable string
 */
function formatDuration(ms) {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${(ms / 60000).toFixed(1)}m`;
}

/**
 * Generate time series data points
 */
function generateTimeSeriesLabels(range, interval = 'hour') {
    const labels = [];
    const now = new Date();
    let points;
    let stepMs;

    switch (range) {
        case '1h':
            points = 60;
            stepMs = 60 * 1000; // 1 minute
            break;
        case '6h':
            points = 72;
            stepMs = 5 * 60 * 1000; // 5 minutes
            break;
        case '24h':
            points = 96;
            stepMs = 15 * 60 * 1000; // 15 minutes
            break;
        case '7d':
            points = 168;
            stepMs = 60 * 60 * 1000; // 1 hour
            break;
        default:
            points = 96;
            stepMs = 15 * 60 * 1000;
    }

    for (let i = points - 1; i >= 0; i--) {
        labels.push(new Date(now.getTime() - (i * stepMs)));
    }

    return labels;
}

// Export all utilities
export {
    ColorPalette,
    DarkModeColors,
    isDarkMode,
    getThemeColors,
    getCommonOptions,
    getLineChartOptions,
    getBarChartOptions,
    getPieChartOptions,
    createGradient,
    createThroughputChart,
    createErrorRateChart,
    createProviderLoadChart,
    createTokenUsageChart,
    createHealthTimelineChart,
    createTopModelsChart,
    updateChartTheme,
    formatNumber,
    formatDuration,
    generateTimeSeriesLabels
};

console.log('Charts module loaded');
