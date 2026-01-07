/**
 * Metrics Service
 * Collects and aggregates request metrics for the armorcode-proxy-api dashboard
 */

import { query, getPool, isConnected } from './postgres-client.js';

/**
 * MetricsService Class
 * Provides metrics collection, aggregation, and querying capabilities
 */
class MetricsService {
    constructor() {
        this._enabled = false;
        this._aggregationInterval = null;
        this._aggregationIntervalMs = 60 * 60 * 1000; // 1 hour default

        // In-memory fallback counters when Postgres is unavailable
        this._inMemoryCounters = {
            totalRequests: 0,
            successfulRequests: 0,
            failedRequests: 0,
            totalInputTokens: 0,
            totalOutputTokens: 0,
            totalLatencyMs: 0,
            requestsByProvider: {},
            requestsByModel: {},
            healthEvents: [],
            recentRequests: [], // Circular buffer for recent requests
        };
        this._maxRecentRequests = 1000; // Max recent requests to keep in memory

        // Log level control
        this._logLevel = process.env.METRICS_LOG_LEVEL || 'info';
    }

    /**
     * Log output method with log level control
     * @private
     */
    _log(level, message) {
        const levels = { debug: 0, info: 1, warn: 2, error: 3 };
        if (levels[level] >= levels[this._logLevel]) {
            const logMethod = level === 'debug' ? 'log' : level;
            console[logMethod](`[MetricsService] ${message}`);
        }
    }

    /**
     * Initialize the metrics service
     * @returns {Promise<boolean>} True if initialization was successful
     */
    async initialize() {
        try {
            if (isConnected()) {
                this._enabled = true;
                this._log('info', 'Metrics service initialized with Postgres');
            } else {
                this._enabled = false;
                this._log('warn', 'Postgres not connected, using in-memory fallback');
            }
            return true;
        } catch (error) {
            this._log('error', `Failed to initialize metrics service: ${error.message}`);
            this._enabled = false;
            return false;
        }
    }

    /**
     * Check if metrics service is enabled (Postgres connected)
     * @returns {boolean}
     */
    isEnabled() {
        return this._enabled && isConnected();
    }

    /**
     * Record a request metric
     * @param {Object} metrics - Request metrics object
     * @param {string} metrics.requestId - UUID of the request
     * @param {string} metrics.providerType - Provider type (e.g., 'gemini-cli-oauth')
     * @param {string} metrics.providerUuid - Provider instance UUID
     * @param {string} metrics.model - Model name
     * @param {number} metrics.inputTokens - Number of input tokens
     * @param {number} metrics.outputTokens - Number of output tokens
     * @param {number} metrics.latencyMs - Request duration in milliseconds
     * @param {number} metrics.statusCode - HTTP status code
     * @param {boolean} metrics.isStreaming - Whether request was streaming
     * @param {string|null} metrics.errorMessage - Error message if failed
     * @param {string} metrics.clientIp - Client IP address
     */
    async recordRequest(metrics) {
        const {
            requestId,
            providerType,
            providerUuid,
            model,
            inputTokens,
            outputTokens,
            latencyMs,
            statusCode,
            isStreaming,
            errorMessage,
            clientIp,
        } = metrics;

        // Always update in-memory counters
        this._updateInMemoryCounters(metrics);

        // Try to persist to Postgres
        if (this.isEnabled()) {
            try {
                const sql = `
                    INSERT INTO requests (
                        request_id, provider_type, provider_uuid, model,
                        input_tokens, output_tokens, latency_ms, status_code,
                        is_streaming, error_message, client_ip
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
                `;
                await query(sql, [
                    requestId,
                    providerType,
                    providerUuid,
                    model,
                    inputTokens || null,
                    outputTokens || null,
                    latencyMs || null,
                    statusCode,
                    isStreaming || false,
                    errorMessage || null,
                    clientIp || null,
                ]);
                this._log('debug', `Recorded request: ${requestId}`);
            } catch (error) {
                this._log('error', `Failed to record request to Postgres: ${error.message}`);
                // Don't crash, in-memory counters already updated
            }
        } else {
            this._log('debug', `Recorded request to in-memory (Postgres unavailable): ${requestId}`);
        }
    }

    /**
     * Update in-memory counters for fallback mode
     * @private
     */
    _updateInMemoryCounters(metrics) {
        const {
            requestId,
            providerType,
            model,
            inputTokens,
            outputTokens,
            latencyMs,
            statusCode,
            errorMessage,
        } = metrics;

        this._inMemoryCounters.totalRequests++;

        if (statusCode >= 200 && statusCode < 400 && !errorMessage) {
            this._inMemoryCounters.successfulRequests++;
        } else {
            this._inMemoryCounters.failedRequests++;
        }

        this._inMemoryCounters.totalInputTokens += inputTokens || 0;
        this._inMemoryCounters.totalOutputTokens += outputTokens || 0;
        this._inMemoryCounters.totalLatencyMs += latencyMs || 0;

        // By provider
        if (providerType) {
            if (!this._inMemoryCounters.requestsByProvider[providerType]) {
                this._inMemoryCounters.requestsByProvider[providerType] = {
                    total: 0,
                    successful: 0,
                    failed: 0,
                };
            }
            this._inMemoryCounters.requestsByProvider[providerType].total++;
            if (statusCode >= 200 && statusCode < 400 && !errorMessage) {
                this._inMemoryCounters.requestsByProvider[providerType].successful++;
            } else {
                this._inMemoryCounters.requestsByProvider[providerType].failed++;
            }
        }

        // By model
        if (model) {
            if (!this._inMemoryCounters.requestsByModel[model]) {
                this._inMemoryCounters.requestsByModel[model] = {
                    total: 0,
                    inputTokens: 0,
                    outputTokens: 0,
                };
            }
            this._inMemoryCounters.requestsByModel[model].total++;
            this._inMemoryCounters.requestsByModel[model].inputTokens += inputTokens || 0;
            this._inMemoryCounters.requestsByModel[model].outputTokens += outputTokens || 0;
        }

        // Circular buffer for recent requests
        this._inMemoryCounters.recentRequests.push({
            requestId,
            providerType,
            model,
            latencyMs,
            statusCode,
            timestamp: new Date().toISOString(),
        });
        if (this._inMemoryCounters.recentRequests.length > this._maxRecentRequests) {
            this._inMemoryCounters.recentRequests.shift();
        }
    }

    /**
     * Record a health event
     * @param {Object} event - Health event object
     * @param {string} event.providerUuid - Provider UUID
     * @param {string} event.providerType - Provider type
     * @param {string} event.eventType - Event type ('unhealthy', 'healthy', 'disabled', 'enabled')
     * @param {number} event.errorCode - Error code (optional)
     * @param {string} event.errorMessage - Error message (optional)
     */
    async recordHealthEvent(event) {
        const {
            providerUuid,
            providerType,
            eventType,
            errorCode,
            errorMessage,
        } = event;

        // Always update in-memory
        this._inMemoryCounters.healthEvents.push({
            providerUuid,
            providerType,
            eventType,
            errorCode,
            errorMessage,
            timestamp: new Date().toISOString(),
        });

        // Limit in-memory health events
        if (this._inMemoryCounters.healthEvents.length > 500) {
            this._inMemoryCounters.healthEvents.shift();
        }

        // Try to persist to Postgres
        if (this.isEnabled()) {
            try {
                const sql = `
                    INSERT INTO provider_health_events (
                        provider_uuid, provider_type, event_type, error_code, error_message
                    ) VALUES ($1, $2, $3, $4, $5)
                `;
                await query(sql, [
                    providerUuid,
                    providerType,
                    eventType,
                    errorCode || null,
                    errorMessage || null,
                ]);
                this._log('debug', `Recorded health event: ${eventType} for ${providerUuid}`);
            } catch (error) {
                this._log('error', `Failed to record health event to Postgres: ${error.message}`);
            }
        }
    }

    /**
     * Start the background aggregation job
     * @param {number} intervalMs - Aggregation interval in milliseconds (default: 1 hour)
     */
    startAggregationJob(intervalMs = null) {
        if (this._aggregationInterval) {
            this._log('warn', 'Aggregation job already running');
            return;
        }

        const interval = intervalMs || this._aggregationIntervalMs;
        this._log('info', `Starting aggregation job with interval: ${interval}ms`);

        // Run immediately on start
        this._runAggregation();

        // Then run periodically
        this._aggregationInterval = setInterval(() => {
            this._runAggregation();
        }, interval);
    }

    /**
     * Stop the background aggregation job
     */
    stopAggregationJob() {
        if (this._aggregationInterval) {
            clearInterval(this._aggregationInterval);
            this._aggregationInterval = null;
            this._log('info', 'Aggregation job stopped');
        }
    }

    /**
     * Run the aggregation process
     * @private
     */
    async _runAggregation() {
        if (!this.isEnabled()) {
            this._log('debug', 'Skipping aggregation: Postgres not available');
            return;
        }

        this._log('info', 'Running hourly aggregation...');

        try {
            // Get the previous complete hour
            const now = new Date();
            const hourBucket = new Date(now);
            hourBucket.setMinutes(0, 0, 0);
            hourBucket.setHours(hourBucket.getHours() - 1);

            const hourStart = hourBucket.toISOString();
            const hourEnd = new Date(hourBucket.getTime() + 60 * 60 * 1000).toISOString();

            // Aggregate requests for the previous hour
            const aggregationSql = `
                WITH hourly_stats AS (
                    SELECT
                        $1::timestamptz AS hour_bucket,
                        provider_type,
                        model,
                        COUNT(*) AS total_requests,
                        COUNT(*) FILTER (WHERE status_code >= 200 AND status_code < 400 AND error_message IS NULL) AS successful_requests,
                        COUNT(*) FILTER (WHERE status_code >= 400 OR error_message IS NOT NULL) AS failed_requests,
                        COALESCE(SUM(input_tokens), 0) AS total_input_tokens,
                        COALESCE(SUM(output_tokens), 0) AS total_output_tokens,
                        COALESCE(AVG(latency_ms)::integer, 0) AS avg_latency_ms,
                        COALESCE(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY latency_ms)::integer, 0) AS p95_latency_ms
                    FROM requests
                    WHERE timestamp >= $2 AND timestamp < $3
                    GROUP BY provider_type, model
                )
                INSERT INTO hourly_aggregates (
                    hour_bucket, provider_type, model, total_requests, successful_requests,
                    failed_requests, total_input_tokens, total_output_tokens, avg_latency_ms, p95_latency_ms
                )
                SELECT * FROM hourly_stats
                ON CONFLICT (hour_bucket, provider_type, model)
                DO UPDATE SET
                    total_requests = EXCLUDED.total_requests,
                    successful_requests = EXCLUDED.successful_requests,
                    failed_requests = EXCLUDED.failed_requests,
                    total_input_tokens = EXCLUDED.total_input_tokens,
                    total_output_tokens = EXCLUDED.total_output_tokens,
                    avg_latency_ms = EXCLUDED.avg_latency_ms,
                    p95_latency_ms = EXCLUDED.p95_latency_ms
            `;

            await query(aggregationSql, [hourStart, hourStart, hourEnd]);
            this._log('info', `Aggregation completed for hour: ${hourStart}`);
        } catch (error) {
            this._log('error', `Aggregation failed: ${error.message}`);
        }
    }

    /**
     * Parse time range string to start date
     * @private
     * @param {string} range - Time range ('1h', '24h', '7d', '30d')
     * @returns {Date}
     */
    _parseRange(range) {
        const now = new Date();
        const match = range.match(/^(\d+)([hdwm])$/);
        if (!match) {
            // Default to 24 hours
            return new Date(now.getTime() - 24 * 60 * 60 * 1000);
        }

        const value = parseInt(match[1], 10);
        const unit = match[2];

        switch (unit) {
            case 'h':
                return new Date(now.getTime() - value * 60 * 60 * 1000);
            case 'd':
                return new Date(now.getTime() - value * 24 * 60 * 60 * 1000);
            case 'w':
                return new Date(now.getTime() - value * 7 * 24 * 60 * 60 * 1000);
            case 'm':
                return new Date(now.getTime() - value * 30 * 24 * 60 * 60 * 1000);
            default:
                return new Date(now.getTime() - 24 * 60 * 60 * 1000);
        }
    }

    /**
     * Get overview statistics for dashboard cards
     * @returns {Promise<Object>}
     */
    async getOverview() {
        // If Postgres not available, return in-memory stats
        if (!this.isEnabled()) {
            const avgLatency = this._inMemoryCounters.totalRequests > 0
                ? Math.round(this._inMemoryCounters.totalLatencyMs / this._inMemoryCounters.totalRequests)
                : 0;

            return {
                source: 'in-memory',
                totalRequests: this._inMemoryCounters.totalRequests,
                successfulRequests: this._inMemoryCounters.successfulRequests,
                failedRequests: this._inMemoryCounters.failedRequests,
                successRate: this._inMemoryCounters.totalRequests > 0
                    ? ((this._inMemoryCounters.successfulRequests / this._inMemoryCounters.totalRequests) * 100).toFixed(2)
                    : 0,
                totalInputTokens: this._inMemoryCounters.totalInputTokens,
                totalOutputTokens: this._inMemoryCounters.totalOutputTokens,
                avgLatencyMs: avgLatency,
                activeProviders: Object.keys(this._inMemoryCounters.requestsByProvider).length,
                activeModels: Object.keys(this._inMemoryCounters.requestsByModel).length,
            };
        }

        try {
            // Get stats for the last 24 hours
            const startTime = this._parseRange('24h').toISOString();

            const overviewSql = `
                SELECT
                    COUNT(*) AS total_requests,
                    COUNT(*) FILTER (WHERE status_code >= 200 AND status_code < 400 AND error_message IS NULL) AS successful_requests,
                    COUNT(*) FILTER (WHERE status_code >= 400 OR error_message IS NOT NULL) AS failed_requests,
                    COALESCE(SUM(input_tokens), 0) AS total_input_tokens,
                    COALESCE(SUM(output_tokens), 0) AS total_output_tokens,
                    COALESCE(AVG(latency_ms)::integer, 0) AS avg_latency_ms,
                    COUNT(DISTINCT provider_type) AS active_providers,
                    COUNT(DISTINCT model) AS active_models
                FROM requests
                WHERE timestamp >= $1
            `;

            const result = await query(overviewSql, [startTime]);
            const row = result.rows[0];

            return {
                source: 'postgres',
                totalRequests: parseInt(row.total_requests, 10),
                successfulRequests: parseInt(row.successful_requests, 10),
                failedRequests: parseInt(row.failed_requests, 10),
                successRate: row.total_requests > 0
                    ? ((row.successful_requests / row.total_requests) * 100).toFixed(2)
                    : 0,
                totalInputTokens: parseInt(row.total_input_tokens, 10),
                totalOutputTokens: parseInt(row.total_output_tokens, 10),
                avgLatencyMs: parseInt(row.avg_latency_ms, 10),
                activeProviders: parseInt(row.active_providers, 10),
                activeModels: parseInt(row.active_models, 10),
            };
        } catch (error) {
            this._log('error', `Failed to get overview: ${error.message}`);
            // Return in-memory fallback directly (avoid infinite recursion)
            const avgLatency = this._inMemoryCounters.totalRequests > 0
                ? Math.round(this._inMemoryCounters.totalLatencyMs / this._inMemoryCounters.totalRequests)
                : 0;

            return {
                source: 'in-memory-fallback',
                totalRequests: this._inMemoryCounters.totalRequests,
                successfulRequests: this._inMemoryCounters.successfulRequests,
                failedRequests: this._inMemoryCounters.failedRequests,
                successRate: this._inMemoryCounters.totalRequests > 0
                    ? ((this._inMemoryCounters.successfulRequests / this._inMemoryCounters.totalRequests) * 100).toFixed(2)
                    : 0,
                totalInputTokens: this._inMemoryCounters.totalInputTokens,
                totalOutputTokens: this._inMemoryCounters.totalOutputTokens,
                avgLatencyMs: avgLatency,
                activeProviders: Object.keys(this._inMemoryCounters.requestsByProvider).length,
                activeModels: Object.keys(this._inMemoryCounters.requestsByModel).length,
            };
        }
    }

    /**
     * Get requests time series for throughput chart
     * @param {string} range - Time range ('1h', '24h', '7d', '30d')
     * @returns {Promise<Array>}
     */
    async getRequestsTimeSeries(range = '24h') {
        if (!this.isEnabled()) {
            // Return empty array for in-memory mode
            return {
                source: 'in-memory',
                data: [],
            };
        }

        try {
            const startTime = this._parseRange(range).toISOString();

            // Use aggregates for longer ranges, raw data for shorter
            const parsedRange = range.match(/^(\d+)([hdwm])$/);
            const useAggregates = parsedRange && (
                (parsedRange[2] === 'd' && parseInt(parsedRange[1], 10) >= 1) ||
                (parsedRange[2] === 'w') ||
                (parsedRange[2] === 'm')
            );

            let sql;
            if (useAggregates) {
                sql = `
                    SELECT
                        hour_bucket AS time_bucket,
                        SUM(total_requests) AS total_requests,
                        SUM(successful_requests) AS successful_requests,
                        SUM(failed_requests) AS failed_requests
                    FROM hourly_aggregates
                    WHERE hour_bucket >= $1
                    GROUP BY hour_bucket
                    ORDER BY hour_bucket
                `;
            } else {
                sql = `
                    SELECT
                        date_trunc('hour', timestamp) AS time_bucket,
                        COUNT(*) AS total_requests,
                        COUNT(*) FILTER (WHERE status_code >= 200 AND status_code < 400 AND error_message IS NULL) AS successful_requests,
                        COUNT(*) FILTER (WHERE status_code >= 400 OR error_message IS NOT NULL) AS failed_requests
                    FROM requests
                    WHERE timestamp >= $1
                    GROUP BY time_bucket
                    ORDER BY time_bucket
                `;
            }

            const result = await query(sql, [startTime]);

            return {
                source: 'postgres',
                data: result.rows.map(row => ({
                    timeBucket: row.time_bucket,
                    totalRequests: parseInt(row.total_requests, 10),
                    successfulRequests: parseInt(row.successful_requests, 10),
                    failedRequests: parseInt(row.failed_requests, 10),
                })),
            };
        } catch (error) {
            this._log('error', `Failed to get requests time series: ${error.message}`);
            return { source: 'error', data: [], error: error.message };
        }
    }

    /**
     * Get latency statistics
     * @param {string} range - Time range
     * @returns {Promise<Object>}
     */
    async getLatencyStats(range = '24h') {
        if (!this.isEnabled()) {
            // Calculate from recent requests
            const latencies = this._inMemoryCounters.recentRequests
                .filter(r => r.latencyMs)
                .map(r => r.latencyMs)
                .sort((a, b) => a - b);

            if (latencies.length === 0) {
                return {
                    source: 'in-memory',
                    avg: 0,
                    min: 0,
                    max: 0,
                    p50: 0,
                    p90: 0,
                    p95: 0,
                    p99: 0,
                };
            }

            const percentile = (arr, p) => {
                const index = Math.ceil(arr.length * p) - 1;
                return arr[Math.max(0, index)];
            };

            return {
                source: 'in-memory',
                avg: Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length),
                min: latencies[0],
                max: latencies[latencies.length - 1],
                p50: percentile(latencies, 0.5),
                p90: percentile(latencies, 0.9),
                p95: percentile(latencies, 0.95),
                p99: percentile(latencies, 0.99),
            };
        }

        try {
            const startTime = this._parseRange(range).toISOString();

            const sql = `
                SELECT
                    COALESCE(AVG(latency_ms)::integer, 0) AS avg,
                    COALESCE(MIN(latency_ms), 0) AS min,
                    COALESCE(MAX(latency_ms), 0) AS max,
                    COALESCE(PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY latency_ms)::integer, 0) AS p50,
                    COALESCE(PERCENTILE_CONT(0.90) WITHIN GROUP (ORDER BY latency_ms)::integer, 0) AS p90,
                    COALESCE(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY latency_ms)::integer, 0) AS p95,
                    COALESCE(PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY latency_ms)::integer, 0) AS p99
                FROM requests
                WHERE timestamp >= $1 AND latency_ms IS NOT NULL
            `;

            const result = await query(sql, [startTime]);
            const row = result.rows[0];

            return {
                source: 'postgres',
                avg: parseInt(row.avg, 10),
                min: parseInt(row.min, 10),
                max: parseInt(row.max, 10),
                p50: parseInt(row.p50, 10),
                p90: parseInt(row.p90, 10),
                p95: parseInt(row.p95, 10),
                p99: parseInt(row.p99, 10),
            };
        } catch (error) {
            this._log('error', `Failed to get latency stats: ${error.message}`);
            return { source: 'error', error: error.message };
        }
    }

    /**
     * Get error statistics by provider and model
     * @param {string} range - Time range
     * @returns {Promise<Object>}
     */
    async getErrorStats(range = '24h') {
        if (!this.isEnabled()) {
            // Calculate from in-memory data
            const byProvider = Object.entries(this._inMemoryCounters.requestsByProvider).map(([provider, stats]) => ({
                providerType: provider,
                totalRequests: stats.total,
                failedRequests: stats.failed,
                errorRate: stats.total > 0 ? ((stats.failed / stats.total) * 100).toFixed(2) : 0,
            }));

            return {
                source: 'in-memory',
                byProvider,
                byModel: [],
                byErrorCode: [],
            };
        }

        try {
            const startTime = this._parseRange(range).toISOString();

            // By provider
            const byProviderSql = `
                SELECT
                    provider_type,
                    COUNT(*) AS total_requests,
                    COUNT(*) FILTER (WHERE status_code >= 400 OR error_message IS NOT NULL) AS failed_requests,
                    ROUND(
                        COUNT(*) FILTER (WHERE status_code >= 400 OR error_message IS NOT NULL)::numeric /
                        NULLIF(COUNT(*), 0) * 100, 2
                    ) AS error_rate
                FROM requests
                WHERE timestamp >= $1
                GROUP BY provider_type
                ORDER BY failed_requests DESC
            `;

            // By model
            const byModelSql = `
                SELECT
                    model,
                    COUNT(*) AS total_requests,
                    COUNT(*) FILTER (WHERE status_code >= 400 OR error_message IS NOT NULL) AS failed_requests,
                    ROUND(
                        COUNT(*) FILTER (WHERE status_code >= 400 OR error_message IS NOT NULL)::numeric /
                        NULLIF(COUNT(*), 0) * 100, 2
                    ) AS error_rate
                FROM requests
                WHERE timestamp >= $1
                GROUP BY model
                ORDER BY failed_requests DESC
            `;

            // By error code
            const byErrorCodeSql = `
                SELECT
                    status_code,
                    COUNT(*) AS count
                FROM requests
                WHERE timestamp >= $1 AND (status_code >= 400 OR error_message IS NOT NULL)
                GROUP BY status_code
                ORDER BY count DESC
            `;

            const [byProviderResult, byModelResult, byErrorCodeResult] = await Promise.all([
                query(byProviderSql, [startTime]),
                query(byModelSql, [startTime]),
                query(byErrorCodeSql, [startTime]),
            ]);

            return {
                source: 'postgres',
                byProvider: byProviderResult.rows.map(row => ({
                    providerType: row.provider_type,
                    totalRequests: parseInt(row.total_requests, 10),
                    failedRequests: parseInt(row.failed_requests, 10),
                    errorRate: parseFloat(row.error_rate) || 0,
                })),
                byModel: byModelResult.rows.map(row => ({
                    model: row.model,
                    totalRequests: parseInt(row.total_requests, 10),
                    failedRequests: parseInt(row.failed_requests, 10),
                    errorRate: parseFloat(row.error_rate) || 0,
                })),
                byErrorCode: byErrorCodeResult.rows.map(row => ({
                    statusCode: row.status_code,
                    count: parseInt(row.count, 10),
                })),
            };
        } catch (error) {
            this._log('error', `Failed to get error stats: ${error.message}`);
            return { source: 'error', error: error.message };
        }
    }

    /**
     * Get token usage statistics
     * @param {string} range - Time range
     * @returns {Promise<Object>}
     */
    async getTokenStats(range = '24h') {
        if (!this.isEnabled()) {
            const byModel = Object.entries(this._inMemoryCounters.requestsByModel).map(([model, stats]) => ({
                model,
                inputTokens: stats.inputTokens,
                outputTokens: stats.outputTokens,
                totalTokens: stats.inputTokens + stats.outputTokens,
            }));

            return {
                source: 'in-memory',
                totalInputTokens: this._inMemoryCounters.totalInputTokens,
                totalOutputTokens: this._inMemoryCounters.totalOutputTokens,
                totalTokens: this._inMemoryCounters.totalInputTokens + this._inMemoryCounters.totalOutputTokens,
                byModel,
                byProvider: [],
            };
        }

        try {
            const startTime = this._parseRange(range).toISOString();

            // Overall totals
            const totalsSql = `
                SELECT
                    COALESCE(SUM(input_tokens), 0) AS total_input_tokens,
                    COALESCE(SUM(output_tokens), 0) AS total_output_tokens
                FROM requests
                WHERE timestamp >= $1
            `;

            // By model
            const byModelSql = `
                SELECT
                    model,
                    COALESCE(SUM(input_tokens), 0) AS input_tokens,
                    COALESCE(SUM(output_tokens), 0) AS output_tokens
                FROM requests
                WHERE timestamp >= $1
                GROUP BY model
                ORDER BY (COALESCE(SUM(input_tokens), 0) + COALESCE(SUM(output_tokens), 0)) DESC
            `;

            // By provider
            const byProviderSql = `
                SELECT
                    provider_type,
                    COALESCE(SUM(input_tokens), 0) AS input_tokens,
                    COALESCE(SUM(output_tokens), 0) AS output_tokens
                FROM requests
                WHERE timestamp >= $1
                GROUP BY provider_type
                ORDER BY (COALESCE(SUM(input_tokens), 0) + COALESCE(SUM(output_tokens), 0)) DESC
            `;

            const [totalsResult, byModelResult, byProviderResult] = await Promise.all([
                query(totalsSql, [startTime]),
                query(byModelSql, [startTime]),
                query(byProviderSql, [startTime]),
            ]);

            const totals = totalsResult.rows[0];

            return {
                source: 'postgres',
                totalInputTokens: parseInt(totals.total_input_tokens, 10),
                totalOutputTokens: parseInt(totals.total_output_tokens, 10),
                totalTokens: parseInt(totals.total_input_tokens, 10) + parseInt(totals.total_output_tokens, 10),
                byModel: byModelResult.rows.map(row => ({
                    model: row.model,
                    inputTokens: parseInt(row.input_tokens, 10),
                    outputTokens: parseInt(row.output_tokens, 10),
                    totalTokens: parseInt(row.input_tokens, 10) + parseInt(row.output_tokens, 10),
                })),
                byProvider: byProviderResult.rows.map(row => ({
                    providerType: row.provider_type,
                    inputTokens: parseInt(row.input_tokens, 10),
                    outputTokens: parseInt(row.output_tokens, 10),
                    totalTokens: parseInt(row.input_tokens, 10) + parseInt(row.output_tokens, 10),
                })),
            };
        } catch (error) {
            this._log('error', `Failed to get token stats: ${error.message}`);
            return { source: 'error', error: error.message };
        }
    }

    /**
     * Get health event timeline
     * @param {string} range - Time range
     * @returns {Promise<Object>}
     */
    async getHealthTimeline(range = '24h') {
        if (!this.isEnabled()) {
            return {
                source: 'in-memory',
                events: this._inMemoryCounters.healthEvents.slice(-100),
            };
        }

        try {
            const startTime = this._parseRange(range).toISOString();

            const sql = `
                SELECT
                    timestamp,
                    provider_uuid,
                    provider_type,
                    event_type,
                    error_code,
                    error_message
                FROM provider_health_events
                WHERE timestamp >= $1
                ORDER BY timestamp DESC
                LIMIT 500
            `;

            const result = await query(sql, [startTime]);

            return {
                source: 'postgres',
                events: result.rows.map(row => ({
                    timestamp: row.timestamp,
                    providerUuid: row.provider_uuid,
                    providerType: row.provider_type,
                    eventType: row.event_type,
                    errorCode: row.error_code,
                    errorMessage: row.error_message,
                })),
            };
        } catch (error) {
            this._log('error', `Failed to get health timeline: ${error.message}`);
            return { source: 'error', error: error.message };
        }
    }

    /**
     * Get provider load distribution
     * @param {string} range - Time range
     * @returns {Promise<Object>}
     */
    async getProviderLoad(range = '24h') {
        if (!this.isEnabled()) {
            const providers = Object.entries(this._inMemoryCounters.requestsByProvider).map(([provider, stats]) => ({
                providerType: provider,
                requestCount: stats.total,
                percentage: this._inMemoryCounters.totalRequests > 0
                    ? ((stats.total / this._inMemoryCounters.totalRequests) * 100).toFixed(2)
                    : 0,
            }));

            return {
                source: 'in-memory',
                providers,
            };
        }

        try {
            const startTime = this._parseRange(range).toISOString();

            const sql = `
                WITH totals AS (
                    SELECT COUNT(*) AS total FROM requests WHERE timestamp >= $1
                )
                SELECT
                    r.provider_type,
                    r.provider_uuid,
                    COUNT(*) AS request_count,
                    ROUND(COUNT(*)::numeric / NULLIF(t.total, 0) * 100, 2) AS percentage,
                    COUNT(*) FILTER (WHERE r.status_code >= 400 OR r.error_message IS NOT NULL) AS error_count,
                    COALESCE(AVG(r.latency_ms)::integer, 0) AS avg_latency_ms
                FROM requests r
                CROSS JOIN totals t
                WHERE r.timestamp >= $1
                GROUP BY r.provider_type, r.provider_uuid, t.total
                ORDER BY request_count DESC
            `;

            const result = await query(sql, [startTime]);

            return {
                source: 'postgres',
                providers: result.rows.map(row => ({
                    providerType: row.provider_type,
                    providerUuid: row.provider_uuid,
                    requestCount: parseInt(row.request_count, 10),
                    percentage: parseFloat(row.percentage) || 0,
                    errorCount: parseInt(row.error_count, 10),
                    avgLatencyMs: parseInt(row.avg_latency_ms, 10),
                })),
            };
        } catch (error) {
            this._log('error', `Failed to get provider load: ${error.message}`);
            return { source: 'error', error: error.message };
        }
    }

    /**
     * Get in-memory counters (for debugging/monitoring)
     * @returns {Object}
     */
    getInMemoryCounters() {
        return {
            ...this._inMemoryCounters,
            recentRequestsCount: this._inMemoryCounters.recentRequests.length,
            healthEventsCount: this._inMemoryCounters.healthEvents.length,
        };
    }

    /**
     * Reset in-memory counters
     */
    resetInMemoryCounters() {
        this._inMemoryCounters = {
            totalRequests: 0,
            successfulRequests: 0,
            failedRequests: 0,
            totalInputTokens: 0,
            totalOutputTokens: 0,
            totalLatencyMs: 0,
            requestsByProvider: {},
            requestsByModel: {},
            healthEvents: [],
            recentRequests: [],
        };
        this._log('info', 'In-memory counters reset');
    }

    /**
     * Graceful shutdown
     */
    async shutdown() {
        this.stopAggregationJob();
        this._log('info', 'Metrics service shutdown complete');
    }
}

// Export singleton instance
export const metricsService = new MetricsService();

// Export class for testing
export { MetricsService };

export default metricsService;
