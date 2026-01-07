import Redis from 'ioredis';

// Redis configuration from environment variables
const REDIS_CONFIG = {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT, 10) || 6379,
    password: process.env.REDIS_PASSWORD || undefined,
    enabled: process.env.REDIS_ENABLED === 'true'
};

// Namespace prefixes for key isolation
const NAMESPACE = {
    BASE: 'armorcode:',
    CACHE: 'armorcode:cache:',
    METRICS: 'armorcode:metrics:'
};

// Internal stats tracking
const stats = {
    hits: 0,
    misses: 0,
    errors: 0,
    lastError: null,
    connected: false,
    connectionAttempts: 0
};

// Singleton Redis client instance
let redisClient = null;
let isShuttingDown = false;

/**
 * Creates and returns the Redis client singleton.
 * Handles connection, reconnection, and error scenarios gracefully.
 * @returns {Redis|null} The Redis client instance or null if disabled/unavailable
 */
function createClient() {
    if (!REDIS_CONFIG.enabled) {
        console.log('[Redis] Redis is disabled (REDIS_ENABLED !== "true"). Using graceful degradation.');
        return null;
    }

    if (redisClient) {
        return redisClient;
    }

    console.log(`[Redis] Connecting to ${REDIS_CONFIG.host}:${REDIS_CONFIG.port}...`);
    stats.connectionAttempts++;

    const clientOptions = {
        host: REDIS_CONFIG.host,
        port: REDIS_CONFIG.port,
        password: REDIS_CONFIG.password,
        // Automatic reconnection settings
        retryStrategy: (times) => {
            if (isShuttingDown) {
                return null; // Stop reconnecting during shutdown
            }
            const delay = Math.min(times * 500, 5000); // Exponential backoff, max 5 seconds
            console.log(`[Redis] Reconnection attempt ${times}, retrying in ${delay}ms...`);
            stats.connectionAttempts++;
            return delay;
        },
        maxRetriesPerRequest: 3,
        enableReadyCheck: true,
        lazyConnect: false,
        // Connection timeout
        connectTimeout: 10000,
        // Keep alive
        keepAlive: 30000
    };

    // Only include password if it's defined
    if (!REDIS_CONFIG.password) {
        delete clientOptions.password;
    }

    try {
        redisClient = new Redis(clientOptions);

        // Event handlers
        redisClient.on('connect', () => {
            console.log('[Redis] Connected successfully.');
        });

        redisClient.on('ready', () => {
            console.log('[Redis] Client is ready.');
            stats.connected = true;
            stats.lastError = null;
        });

        redisClient.on('error', (error) => {
            stats.errors++;
            stats.lastError = error.message;
            stats.connected = false;
            // Only log if not shutting down to avoid noise
            if (!isShuttingDown) {
                console.error(`[Redis Error] ${error.message}`);
            }
        });

        redisClient.on('close', () => {
            console.log('[Redis] Connection closed.');
            stats.connected = false;
        });

        redisClient.on('reconnecting', () => {
            console.log('[Redis] Attempting to reconnect...');
        });

        redisClient.on('end', () => {
            console.log('[Redis] Connection ended.');
            stats.connected = false;
        });

        return redisClient;
    } catch (error) {
        console.error(`[Redis Error] Failed to create client: ${error.message}`);
        stats.errors++;
        stats.lastError = error.message;
        return null;
    }
}

/**
 * Gets the Redis client instance, creating it if necessary.
 * @returns {Redis|null} The Redis client or null if unavailable
 */
function getClient() {
    if (!redisClient && REDIS_CONFIG.enabled) {
        return createClient();
    }
    return redisClient;
}

/**
 * Checks if Redis is available and connected.
 * @returns {boolean} True if Redis is available and connected
 */
function isAvailable() {
    return REDIS_CONFIG.enabled && redisClient && stats.connected;
}

/**
 * Gets a value from Redis with namespace prefix.
 * @param {string} key - The key to retrieve (without namespace prefix)
 * @param {string} [namespace='cache'] - The namespace ('cache' or 'metrics')
 * @returns {Promise<string|null>} The value or null if not found/unavailable
 */
async function get(key, namespace = 'cache') {
    if (!isAvailable()) {
        stats.misses++;
        return null;
    }

    const prefix = namespace === 'metrics' ? NAMESPACE.METRICS : NAMESPACE.CACHE;
    const fullKey = `${prefix}${key}`;

    try {
        const value = await redisClient.get(fullKey);
        if (value !== null) {
            stats.hits++;
        } else {
            stats.misses++;
        }
        return value;
    } catch (error) {
        console.error(`[Redis Error] GET ${fullKey}: ${error.message}`);
        stats.errors++;
        stats.misses++;
        stats.lastError = error.message;
        return null;
    }
}

/**
 * Sets a value in Redis with namespace prefix and optional TTL.
 * @param {string} key - The key to set (without namespace prefix)
 * @param {string|number|object} value - The value to store (objects will be JSON stringified)
 * @param {number} [ttlSeconds] - Optional TTL in seconds
 * @param {string} [namespace='cache'] - The namespace ('cache' or 'metrics')
 * @returns {Promise<boolean>} True if successful, false otherwise
 */
async function set(key, value, ttlSeconds = null, namespace = 'cache') {
    if (!isAvailable()) {
        return false;
    }

    const prefix = namespace === 'metrics' ? NAMESPACE.METRICS : NAMESPACE.CACHE;
    const fullKey = `${prefix}${key}`;

    // Stringify objects
    const stringValue = typeof value === 'object' ? JSON.stringify(value) : String(value);

    try {
        if (ttlSeconds && ttlSeconds > 0) {
            await redisClient.set(fullKey, stringValue, 'EX', ttlSeconds);
        } else {
            await redisClient.set(fullKey, stringValue);
        }
        return true;
    } catch (error) {
        console.error(`[Redis Error] SET ${fullKey}: ${error.message}`);
        stats.errors++;
        stats.lastError = error.message;
        return false;
    }
}

/**
 * Deletes a key from Redis with namespace prefix.
 * @param {string} key - The key to delete (without namespace prefix)
 * @param {string} [namespace='cache'] - The namespace ('cache' or 'metrics')
 * @returns {Promise<boolean>} True if key was deleted, false otherwise
 */
async function del(key, namespace = 'cache') {
    if (!isAvailable()) {
        return false;
    }

    const prefix = namespace === 'metrics' ? NAMESPACE.METRICS : NAMESPACE.CACHE;
    const fullKey = `${prefix}${key}`;

    try {
        const result = await redisClient.del(fullKey);
        return result > 0;
    } catch (error) {
        console.error(`[Redis Error] DEL ${fullKey}: ${error.message}`);
        stats.errors++;
        stats.lastError = error.message;
        return false;
    }
}

/**
 * Gets keys matching a pattern within the namespace.
 * @param {string} pattern - The pattern to match (e.g., 'user:*')
 * @param {string} [namespace='cache'] - The namespace ('cache' or 'metrics')
 * @returns {Promise<string[]>} Array of matching keys (without namespace prefix)
 */
async function keys(pattern, namespace = 'cache') {
    if (!isAvailable()) {
        return [];
    }

    const prefix = namespace === 'metrics' ? NAMESPACE.METRICS : NAMESPACE.CACHE;
    const fullPattern = `${prefix}${pattern}`;

    try {
        const matchedKeys = await redisClient.keys(fullPattern);
        // Remove the namespace prefix from returned keys
        return matchedKeys.map((k) => k.replace(prefix, ''));
    } catch (error) {
        console.error(`[Redis Error] KEYS ${fullPattern}: ${error.message}`);
        stats.errors++;
        stats.lastError = error.message;
        return [];
    }
}

/**
 * Increments a counter in Redis.
 * @param {string} key - The key to increment (without namespace prefix)
 * @param {string} [namespace='metrics'] - The namespace (defaults to 'metrics' for counters)
 * @returns {Promise<number|null>} The new value after increment, or null on failure
 */
async function incr(key, namespace = 'metrics') {
    if (!isAvailable()) {
        return null;
    }

    const prefix = namespace === 'metrics' ? NAMESPACE.METRICS : NAMESPACE.CACHE;
    const fullKey = `${prefix}${key}`;

    try {
        const result = await redisClient.incr(fullKey);
        return result;
    } catch (error) {
        console.error(`[Redis Error] INCR ${fullKey}: ${error.message}`);
        stats.errors++;
        stats.lastError = error.message;
        return null;
    }
}

/**
 * Increments a counter by a specific amount.
 * @param {string} key - The key to increment (without namespace prefix)
 * @param {number} amount - The amount to increment by
 * @param {string} [namespace='metrics'] - The namespace (defaults to 'metrics' for counters)
 * @returns {Promise<number|null>} The new value after increment, or null on failure
 */
async function incrBy(key, amount, namespace = 'metrics') {
    if (!isAvailable()) {
        return null;
    }

    const prefix = namespace === 'metrics' ? NAMESPACE.METRICS : NAMESPACE.CACHE;
    const fullKey = `${prefix}${key}`;

    try {
        const result = await redisClient.incrby(fullKey, amount);
        return result;
    } catch (error) {
        console.error(`[Redis Error] INCRBY ${fullKey}: ${error.message}`);
        stats.errors++;
        stats.lastError = error.message;
        return null;
    }
}

/**
 * Gets cache statistics including hit/miss rates.
 * @returns {Object} Statistics object with hit/miss counts and rates
 */
function getStats() {
    const total = stats.hits + stats.misses;
    const hitRate = total > 0 ? ((stats.hits / total) * 100).toFixed(2) : 0;
    const missRate = total > 0 ? ((stats.misses / total) * 100).toFixed(2) : 0;

    return {
        enabled: REDIS_CONFIG.enabled,
        connected: stats.connected,
        hits: stats.hits,
        misses: stats.misses,
        total: total,
        hitRate: `${hitRate}%`,
        missRate: `${missRate}%`,
        errors: stats.errors,
        lastError: stats.lastError,
        connectionAttempts: stats.connectionAttempts
    };
}

/**
 * Resets the statistics counters.
 */
function resetStats() {
    stats.hits = 0;
    stats.misses = 0;
    stats.errors = 0;
    stats.lastError = null;
    console.log('[Redis] Statistics reset.');
}

/**
 * Performs a health check on the Redis connection.
 * @returns {Promise<Object>} Health check result with status and details
 */
async function healthCheck() {
    const result = {
        service: 'redis',
        status: 'unknown',
        enabled: REDIS_CONFIG.enabled,
        host: REDIS_CONFIG.host,
        port: REDIS_CONFIG.port,
        connected: false,
        latencyMs: null,
        error: null
    };

    if (!REDIS_CONFIG.enabled) {
        result.status = 'disabled';
        return result;
    }

    if (!redisClient) {
        result.status = 'not_initialized';
        result.error = 'Redis client not initialized';
        return result;
    }

    const startTime = Date.now();

    try {
        const pong = await redisClient.ping();
        const latency = Date.now() - startTime;

        if (pong === 'PONG') {
            result.status = 'healthy';
            result.connected = true;
            result.latencyMs = latency;
        } else {
            result.status = 'unhealthy';
            result.error = `Unexpected ping response: ${pong}`;
        }
    } catch (error) {
        result.status = 'unhealthy';
        result.error = error.message;
        result.latencyMs = Date.now() - startTime;
    }

    return result;
}

/**
 * Gracefully shuts down the Redis connection.
 * @returns {Promise<void>}
 */
async function shutdown() {
    if (!redisClient) {
        console.log('[Redis] No client to shutdown.');
        return;
    }

    isShuttingDown = true;
    console.log('[Redis] Shutting down gracefully...');

    try {
        await redisClient.quit();
        console.log('[Redis] Connection closed successfully.');
    } catch (error) {
        console.error(`[Redis Error] Error during shutdown: ${error.message}`);
        // Force disconnect if quit fails
        try {
            redisClient.disconnect();
        } catch (disconnectError) {
            // Ignore disconnect errors during shutdown
        }
    }

    redisClient = null;
    stats.connected = false;
}

/**
 * Initializes the Redis client.
 * Should be called during application startup.
 * @returns {Promise<boolean>} True if initialization successful or gracefully degraded
 */
async function initialize() {
    if (!REDIS_CONFIG.enabled) {
        console.log('[Redis] Initialization skipped - Redis is disabled.');
        return true;
    }

    const client = createClient();

    if (!client) {
        console.warn('[Redis Warning] Failed to create client. Operating in degraded mode.');
        return true; // Return true to allow app to continue
    }

    // Wait for initial connection with timeout
    return new Promise((resolve) => {
        const timeout = setTimeout(() => {
            console.warn('[Redis Warning] Connection timeout. Operating in degraded mode.');
            resolve(true);
        }, 5000);

        const onReady = () => {
            clearTimeout(timeout);
            client.off('error', onError);
            console.log('[Redis] Initialization complete.');
            resolve(true);
        };

        const onError = (error) => {
            clearTimeout(timeout);
            client.off('ready', onReady);
            console.warn(`[Redis Warning] Initial connection failed: ${error.message}. Operating in degraded mode.`);
            resolve(true); // Still resolve true to allow app to continue
        };

        client.once('ready', onReady);
        client.once('error', onError);
    });
}

/**
 * Sets a value with automatic JSON parsing for objects.
 * Convenience wrapper that handles JSON stringification.
 * @param {string} key - The key to set
 * @param {*} value - The value (will be JSON stringified if object)
 * @param {number} [ttlSeconds] - Optional TTL in seconds
 * @param {string} [namespace='cache'] - The namespace
 * @returns {Promise<boolean>} True if successful
 */
async function setJSON(key, value, ttlSeconds = null, namespace = 'cache') {
    return set(key, JSON.stringify(value), ttlSeconds, namespace);
}

/**
 * Gets a value and parses it as JSON.
 * Convenience wrapper that handles JSON parsing.
 * @param {string} key - The key to get
 * @param {string} [namespace='cache'] - The namespace
 * @returns {Promise<*|null>} The parsed value or null
 */
async function getJSON(key, namespace = 'cache') {
    const value = await get(key, namespace);
    if (value === null) {
        return null;
    }
    try {
        return JSON.parse(value);
    } catch (error) {
        console.warn(`[Redis Warning] Failed to parse JSON for key ${key}: ${error.message}`);
        return value; // Return raw value if JSON parse fails
    }
}

/**
 * Clears all keys in a specific namespace.
 * Use with caution - this deletes all matching keys.
 * @param {string} [namespace='cache'] - The namespace to clear
 * @returns {Promise<number>} Number of keys deleted
 */
async function clearNamespace(namespace = 'cache') {
    if (!isAvailable()) {
        return 0;
    }

    const prefix = namespace === 'metrics' ? NAMESPACE.METRICS : NAMESPACE.CACHE;
    const pattern = `${prefix}*`;

    try {
        const matchedKeys = await redisClient.keys(pattern);
        if (matchedKeys.length === 0) {
            return 0;
        }
        const result = await redisClient.del(...matchedKeys);
        console.log(`[Redis] Cleared ${result} keys from namespace '${namespace}'.`);
        return result;
    } catch (error) {
        console.error(`[Redis Error] CLEAR ${pattern}: ${error.message}`);
        stats.errors++;
        stats.lastError = error.message;
        return 0;
    }
}

// Export the Redis client API
export default {
    initialize,
    getClient,
    isAvailable,
    get,
    set,
    del,
    keys,
    incr,
    incrBy,
    getJSON,
    setJSON,
    getStats,
    resetStats,
    healthCheck,
    clearNamespace,
    shutdown,
    NAMESPACE
};

// Named exports for convenience
export {
    initialize,
    getClient,
    isAvailable,
    get,
    set,
    del,
    keys,
    incr,
    incrBy,
    getJSON,
    setJSON,
    getStats,
    resetStats,
    healthCheck,
    clearNamespace,
    shutdown,
    NAMESPACE
};
