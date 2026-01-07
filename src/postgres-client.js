import pg from 'pg';

const { Pool } = pg;

// Database configuration from environment variables with defaults
const DB_CONFIG = {
    host: process.env.POSTGRES_HOST || 'localhost',
    port: parseInt(process.env.POSTGRES_PORT, 10) || 5432,
    database: process.env.POSTGRES_DB || 'armorcode_proxy',
    user: process.env.POSTGRES_USER || 'armorcode',
    password: process.env.POSTGRES_PASSWORD || 'armorcode_password',
    max: parseInt(process.env.POSTGRES_POOL_SIZE, 10) || 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
};

let pool = null;
let isInitialized = false;

/**
 * SQL migrations for creating database tables
 */
const MIGRATIONS = `
-- requests table: stores individual request data for analytics
CREATE TABLE IF NOT EXISTS requests (
    id SERIAL PRIMARY KEY,
    request_id UUID NOT NULL,
    timestamp TIMESTAMPTZ DEFAULT NOW(),
    provider_type VARCHAR(50),
    provider_uuid VARCHAR(100),
    model VARCHAR(100),
    input_tokens INTEGER,
    output_tokens INTEGER,
    latency_ms INTEGER,
    status_code INTEGER,
    is_streaming BOOLEAN,
    error_message TEXT,
    client_ip VARCHAR(45)
);

-- Create index on timestamp for time-based queries
CREATE INDEX IF NOT EXISTS idx_requests_timestamp ON requests(timestamp);

-- Create index on provider_type for filtering
CREATE INDEX IF NOT EXISTS idx_requests_provider_type ON requests(provider_type);

-- Create index on request_id for lookups
CREATE INDEX IF NOT EXISTS idx_requests_request_id ON requests(request_id);

-- provider_health_events table: tracks provider health state changes
CREATE TABLE IF NOT EXISTS provider_health_events (
    id SERIAL PRIMARY KEY,
    timestamp TIMESTAMPTZ DEFAULT NOW(),
    provider_uuid VARCHAR(100),
    provider_type VARCHAR(50),
    event_type VARCHAR(20),
    error_code INTEGER,
    error_message TEXT
);

-- Create index on timestamp for time-based queries
CREATE INDEX IF NOT EXISTS idx_provider_health_events_timestamp ON provider_health_events(timestamp);

-- Create index on provider_uuid for filtering
CREATE INDEX IF NOT EXISTS idx_provider_health_events_provider_uuid ON provider_health_events(provider_uuid);

-- hourly_aggregates table: pre-computed hourly statistics
CREATE TABLE IF NOT EXISTS hourly_aggregates (
    id SERIAL PRIMARY KEY,
    hour_bucket TIMESTAMPTZ NOT NULL,
    provider_type VARCHAR(50),
    model VARCHAR(100),
    total_requests INTEGER,
    successful_requests INTEGER,
    failed_requests INTEGER,
    total_input_tokens BIGINT,
    total_output_tokens BIGINT,
    avg_latency_ms INTEGER,
    p95_latency_ms INTEGER,
    UNIQUE(hour_bucket, provider_type, model)
);

-- Create index on hour_bucket for time-based queries
CREATE INDEX IF NOT EXISTS idx_hourly_aggregates_hour_bucket ON hourly_aggregates(hour_bucket);
`;

/**
 * Initializes the database connection pool and runs migrations.
 * @returns {Promise<boolean>} True if initialization was successful, false otherwise.
 */
export async function initializePostgres() {
    if (isInitialized) {
        console.log('[Postgres] Already initialized');
        return true;
    }

    try {
        pool = new Pool(DB_CONFIG);

        // Test the connection
        const client = await pool.connect();
        console.log(`[Postgres] Connected to database: ${DB_CONFIG.database}@${DB_CONFIG.host}:${DB_CONFIG.port}`);
        client.release();

        // Run migrations
        await runMigrations();

        isInitialized = true;
        console.log('[Postgres] Initialization complete');
        return true;
    } catch (error) {
        console.error('[Postgres Error] Failed to initialize database:', error.message);
        pool = null;
        return false;
    }
}

/**
 * Runs database migrations to create required tables.
 * @returns {Promise<void>}
 */
async function runMigrations() {
    if (!pool) {
        throw new Error('Database pool not initialized');
    }

    try {
        await pool.query(MIGRATIONS);
        console.log('[Postgres] Migrations completed successfully');
    } catch (error) {
        console.error('[Postgres Error] Migration failed:', error.message);
        throw error;
    }
}

/**
 * Executes a SQL query with optional parameters.
 * @param {string} text - The SQL query text.
 * @param {Array} params - Optional query parameters.
 * @returns {Promise<pg.QueryResult>} The query result.
 */
export async function query(text, params = []) {
    if (!pool) {
        throw new Error('Database not initialized. Call initializePostgres() first.');
    }

    const start = Date.now();
    try {
        const result = await pool.query(text, params);
        const duration = Date.now() - start;

        if (process.env.POSTGRES_DEBUG === 'true') {
            console.log(`[Postgres Query] Executed in ${duration}ms: ${text.substring(0, 100)}...`);
        }

        return result;
    } catch (error) {
        console.error('[Postgres Error] Query failed:', error.message);
        throw error;
    }
}

/**
 * Inserts a record into the specified table.
 * @param {string} tableName - The name of the table.
 * @param {Object} data - An object containing column-value pairs.
 * @returns {Promise<pg.QueryResult>} The query result with the inserted row.
 */
export async function insert(tableName, data) {
    if (!pool) {
        throw new Error('Database not initialized. Call initializePostgres() first.');
    }

    const columns = Object.keys(data);
    const values = Object.values(data);
    const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');

    const text = `INSERT INTO ${tableName} (${columns.join(', ')}) VALUES (${placeholders}) RETURNING *`;

    return query(text, values);
}

/**
 * Returns the database connection pool.
 * @returns {pg.Pool|null} The pool instance or null if not initialized.
 */
export function getPool() {
    return pool;
}

/**
 * Checks if the database is initialized and connected.
 * @returns {boolean} True if initialized, false otherwise.
 */
export function isConnected() {
    return isInitialized && pool !== null;
}

/**
 * Gracefully shuts down the database connection pool.
 * @returns {Promise<void>}
 */
export async function closePostgres() {
    if (pool) {
        console.log('[Postgres] Closing connection pool...');
        await pool.end();
        pool = null;
        isInitialized = false;
        console.log('[Postgres] Connection pool closed');
    }
}

/**
 * Inserts a request record into the requests table.
 * @param {Object} requestData - The request data to insert.
 * @returns {Promise<pg.QueryResult>}
 */
export async function insertRequest(requestData) {
    return insert('requests', {
        request_id: requestData.requestId,
        provider_type: requestData.providerType,
        provider_uuid: requestData.providerUuid,
        model: requestData.model,
        input_tokens: requestData.inputTokens,
        output_tokens: requestData.outputTokens,
        latency_ms: requestData.latencyMs,
        status_code: requestData.statusCode,
        is_streaming: requestData.isStreaming,
        error_message: requestData.errorMessage,
        client_ip: requestData.clientIp,
    });
}

/**
 * Inserts a provider health event into the provider_health_events table.
 * @param {Object} eventData - The health event data to insert.
 * @returns {Promise<pg.QueryResult>}
 */
export async function insertProviderHealthEvent(eventData) {
    return insert('provider_health_events', {
        provider_uuid: eventData.providerUuid,
        provider_type: eventData.providerType,
        event_type: eventData.eventType,
        error_code: eventData.errorCode,
        error_message: eventData.errorMessage,
    });
}

/**
 * Upserts an hourly aggregate record.
 * @param {Object} aggregateData - The aggregate data to upsert.
 * @returns {Promise<pg.QueryResult>}
 */
export async function upsertHourlyAggregate(aggregateData) {
    const text = `
        INSERT INTO hourly_aggregates (
            hour_bucket, provider_type, model, total_requests, successful_requests,
            failed_requests, total_input_tokens, total_output_tokens, avg_latency_ms, p95_latency_ms
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT (hour_bucket, provider_type, model)
        DO UPDATE SET
            total_requests = hourly_aggregates.total_requests + EXCLUDED.total_requests,
            successful_requests = hourly_aggregates.successful_requests + EXCLUDED.successful_requests,
            failed_requests = hourly_aggregates.failed_requests + EXCLUDED.failed_requests,
            total_input_tokens = hourly_aggregates.total_input_tokens + EXCLUDED.total_input_tokens,
            total_output_tokens = hourly_aggregates.total_output_tokens + EXCLUDED.total_output_tokens,
            avg_latency_ms = EXCLUDED.avg_latency_ms,
            p95_latency_ms = EXCLUDED.p95_latency_ms
        RETURNING *
    `;

    const values = [
        aggregateData.hourBucket,
        aggregateData.providerType,
        aggregateData.model,
        aggregateData.totalRequests,
        aggregateData.successfulRequests,
        aggregateData.failedRequests,
        aggregateData.totalInputTokens,
        aggregateData.totalOutputTokens,
        aggregateData.avgLatencyMs,
        aggregateData.p95LatencyMs,
    ];

    return query(text, values);
}

// Setup graceful shutdown handlers
process.on('SIGTERM', async () => {
    console.log('[Postgres] Received SIGTERM signal');
    await closePostgres();
});

process.on('SIGINT', async () => {
    console.log('[Postgres] Received SIGINT signal');
    await closePostgres();
});

export default {
    initializePostgres,
    query,
    insert,
    getPool,
    isConnected,
    closePostgres,
    insertRequest,
    insertProviderHealthEvent,
    upsertHourlyAggregate,
};
