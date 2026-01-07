import crypto from 'crypto';
import redisClient from './redis-client.js';
import { getProtocolPrefix, MODEL_PROTOCOL_PREFIX } from './common.js';
import { query, isConnected } from './postgres-client.js';

// Cache configuration from environment variables
const CACHE_CONFIG = {
    enabled: process.env.CACHE_ENABLED === 'true',
    ttlSeconds: parseInt(process.env.CACHE_TTL_SECONDS, 10) || 3600, // Default: 1 hour
    maxSize: parseInt(process.env.CACHE_MAX_SIZE, 10) || 10000 // For tracking stats only
};

// Cache-specific namespace prefix
const CACHE_PREFIX = 'response:';

// Internal statistics tracking
const cacheStats = {
    hits: 0,
    misses: 0,
    stores: 0,
    invalidations: 0,
    errors: 0
};

/**
 * Generates a unique cache key from model and messages.
 * Uses SHA-256 hash to create a consistent, fixed-length key.
 * @param {string} model - The model identifier
 * @param {Array|Object} messages - The messages array or object
 * @returns {string} The generated cache key
 */
function generateCacheKey(model, messages) {
    const normalizedModel = String(model || '').trim();
    const normalizedMessages = JSON.stringify(messages || []);

    const hashInput = `${normalizedModel}:${normalizedMessages}`;
    const hash = crypto.createHash('sha256').update(hashInput).digest('hex');

    return `${CACHE_PREFIX}${normalizedModel}:${hash}`;
}

/**
 * Extracts messages from request body based on provider format for cache key generation.
 * Different providers use different field names for the messages/content array.
 * @param {Object} requestBody - The original request body
 * @param {string} fromProvider - The client provider format (e.g., 'openai', 'gemini', 'claude')
 * @returns {Array|Object} The messages/contents array for caching
 */
function extractMessagesForCacheKey(requestBody, fromProvider) {
    if (!requestBody) return [];

    const protocol = getProtocolPrefix(fromProvider);
    switch (protocol) {
        case MODEL_PROTOCOL_PREFIX.OPENAI:
        case MODEL_PROTOCOL_PREFIX.CLAUDE:
        case MODEL_PROTOCOL_PREFIX.CLAUDE_CODE:
            return requestBody.messages || [];
        case MODEL_PROTOCOL_PREFIX.GEMINI:
            return requestBody.contents || [];
        case MODEL_PROTOCOL_PREFIX.OPENAI_RESPONSES:
            return requestBody.input || requestBody.messages || [];
        default:
            // Fallback: try common field names
            return requestBody.messages || requestBody.contents || requestBody.input || [];
    }
}

/**
 * Generates a cache key from model and request body, handling different provider formats.
 * @param {string} model - The model identifier
 * @param {Object} requestBody - The original request body
 * @param {string} fromProvider - The client provider format
 * @returns {string} The generated cache key
 */
function generateCacheKeyFromRequest(model, requestBody, fromProvider) {
    const messages = extractMessagesForCacheKey(requestBody, fromProvider);
    return generateCacheKey(model, messages);
}

/**
 * Checks if caching is currently available and enabled.
 * @returns {boolean} True if caching is available
 */
function isCacheAvailable() {
    return CACHE_CONFIG.enabled && redisClient.isAvailable();
}

/**
 * Retrieves a cached response for the given model and messages.
 * @param {string} model - The model identifier
 * @param {Array|Object} messages - The messages array or object
 * @returns {Promise<Object|null>} The cached response or null if not found
 */
async function getCachedResponse(model, messages) {
    if (!CACHE_CONFIG.enabled) {
        console.debug('[CacheService] Cache is disabled, skipping lookup.');
        return null;
    }

    if (!redisClient.isAvailable()) {
        console.debug('[CacheService] Redis unavailable, bypassing cache lookup.');
        cacheStats.misses++;
        return null;
    }

    const cacheKey = generateCacheKey(model, messages);

    try {
        console.debug(`[CacheService] Looking up cache key: ${cacheKey}`);
        const cachedValue = await redisClient.getJSON(cacheKey);

        if (cachedValue !== null) {
            cacheStats.hits++;
            console.debug(`[CacheService] Cache HIT for model: ${model}`);
            return cachedValue;
        } else {
            cacheStats.misses++;
            console.debug(`[CacheService] Cache MISS for model: ${model}`);
            return null;
        }
    } catch (error) {
        console.error(`[CacheService Error] Failed to get cached response: ${error.message}`);
        cacheStats.errors++;
        cacheStats.misses++;
        return null;
    }
}

/**
 * Caches a successful API response.
 * Only caches responses with status 200 for non-streaming requests.
 * @param {string} model - The model identifier
 * @param {Array|Object} messages - The messages array or object
 * @param {Object} response - The response object to cache
 * @param {number} [ttlSeconds] - Optional TTL in seconds (defaults to CACHE_TTL_SECONDS)
 * @returns {Promise<boolean>} True if successfully cached, false otherwise
 */
async function cacheResponse(model, messages, response, ttlSeconds = null) {
    if (!CACHE_CONFIG.enabled) {
        console.debug('[CacheService] Cache is disabled, skipping store.');
        return false;
    }

    if (!redisClient.isAvailable()) {
        console.debug('[CacheService] Redis unavailable, bypassing cache store.');
        return false;
    }

    // Validate response - only cache successful responses
    if (!response) {
        console.debug('[CacheService] No response to cache.');
        return false;
    }

    const cacheKey = generateCacheKey(model, messages);
    const effectiveTtl = ttlSeconds || CACHE_CONFIG.ttlSeconds;

    try {
        console.debug(`[CacheService] Caching response for model: ${model} with TTL: ${effectiveTtl}s`);

        const success = await redisClient.setJSON(cacheKey, response, effectiveTtl);

        if (success) {
            cacheStats.stores++;
            console.debug(`[CacheService] Successfully cached response for key: ${cacheKey}`);
            return true;
        } else {
            console.debug('[CacheService] Failed to store response in cache.');
            return false;
        }
    } catch (error) {
        console.error(`[CacheService Error] Failed to cache response: ${error.message}`);
        cacheStats.errors++;
        return false;
    }
}

/**
 * Invalidates all cached responses for a specific model.
 * Uses pattern matching to find and delete all keys for the model.
 * @param {string} model - The model identifier to invalidate
 * @returns {Promise<number>} Number of keys invalidated
 */
async function invalidateModel(model) {
    if (!CACHE_CONFIG.enabled) {
        console.debug('[CacheService] Cache is disabled, skipping invalidation.');
        return 0;
    }

    if (!redisClient.isAvailable()) {
        console.debug('[CacheService] Redis unavailable, bypassing invalidation.');
        return 0;
    }

    const normalizedModel = String(model || '').trim();
    const pattern = `${CACHE_PREFIX}${normalizedModel}:*`;

    try {
        console.debug(`[CacheService] Invalidating cache for model: ${model}`);

        // Get all keys matching the pattern
        const matchingKeys = await redisClient.keys(pattern);

        if (matchingKeys.length === 0) {
            console.debug(`[CacheService] No cached entries found for model: ${model}`);
            return 0;
        }

        // Delete each matching key
        let deletedCount = 0;
        for (const key of matchingKeys) {
            const deleted = await redisClient.del(key);
            if (deleted) {
                deletedCount++;
            }
        }

        cacheStats.invalidations += deletedCount;
        console.debug(`[CacheService] Invalidated ${deletedCount} entries for model: ${model}`);

        return deletedCount;
    } catch (error) {
        console.error(`[CacheService Error] Failed to invalidate model ${model}: ${error.message}`);
        cacheStats.errors++;
        return 0;
    }
}

/**
 * Clears all cached responses.
 * @returns {Promise<number>} Number of keys cleared
 */
async function clearCache() {
    if (!CACHE_CONFIG.enabled) {
        console.debug('[CacheService] Cache is disabled, skipping clear.');
        return 0;
    }

    if (!redisClient.isAvailable()) {
        console.debug('[CacheService] Redis unavailable, bypassing clear.');
        return 0;
    }

    const pattern = `${CACHE_PREFIX}*`;

    try {
        console.debug('[CacheService] Clearing all cached responses...');

        // Get all cache keys matching our prefix
        const matchingKeys = await redisClient.keys(pattern);

        if (matchingKeys.length === 0) {
            console.debug('[CacheService] No cached entries to clear.');
            return 0;
        }

        // Delete each matching key
        let deletedCount = 0;
        for (const key of matchingKeys) {
            const deleted = await redisClient.del(key);
            if (deleted) {
                deletedCount++;
            }
        }

        cacheStats.invalidations += deletedCount;
        console.debug(`[CacheService] Cleared ${deletedCount} cached entries.`);

        return deletedCount;
    } catch (error) {
        console.error(`[CacheService Error] Failed to clear cache: ${error.message}`);
        cacheStats.errors++;
        return 0;
    }
}

/**
 * Gets cache statistics including hit/miss rates.
 * Combines in-memory stats with Postgres metrics for accurate reporting.
 * @returns {Promise<Object>} Statistics object with cache metrics
 */
async function getCacheStats() {
    let size = 0;
    let dbHits = 0;
    let dbTotal = 0;
    let dbHitRate = '0.00';

    // Try to get current cache size from Redis
    if (CACHE_CONFIG.enabled && redisClient.isAvailable()) {
        try {
            const pattern = `${CACHE_PREFIX}*`;
            const matchingKeys = await redisClient.keys(pattern);
            size = matchingKeys.length;
        } catch (error) {
            console.debug(`[CacheService] Failed to get cache size: ${error.message}`);
        }
    }

    // Get historical cache stats from Postgres (cache hits = requests with providerType='cache')
    if (isConnected()) {
        try {
            const sql = `
                SELECT
                    COUNT(*) FILTER (WHERE provider_type = 'cache') AS cache_hits,
                    COUNT(*) AS total_requests
                FROM requests
                WHERE timestamp >= NOW() - INTERVAL '24 hours'
            `;
            const result = await query(sql, []);
            if (result.rows.length > 0) {
                dbHits = parseInt(result.rows[0].cache_hits, 10) || 0;
                dbTotal = parseInt(result.rows[0].total_requests, 10) || 0;
                dbHitRate = dbTotal > 0 ? ((dbHits / dbTotal) * 100).toFixed(2) : '0.00';
            }
        } catch (error) {
            console.debug(`[CacheService] Failed to get Postgres cache stats: ${error.message}`);
        }
    }

    // Use in-memory stats if available, otherwise use DB stats
    const inMemoryTotal = cacheStats.hits + cacheStats.misses;
    const useDbStats = inMemoryTotal === 0 && dbTotal > 0;

    const effectiveHits = useDbStats ? dbHits : cacheStats.hits;
    const effectiveMisses = useDbStats ? (dbTotal - dbHits) : cacheStats.misses;
    const effectiveTotal = effectiveHits + effectiveMisses;
    const hitRate = effectiveTotal > 0 ? ((effectiveHits / effectiveTotal) * 100).toFixed(2) : '0.00';

    return {
        enabled: CACHE_CONFIG.enabled,
        hits: effectiveHits,
        misses: effectiveMisses,
        hitRate: `${hitRate}%`,
        stores: cacheStats.stores,
        invalidations: cacheStats.invalidations,
        errors: cacheStats.errors,
        size: size,
        maxSize: CACHE_CONFIG.maxSize,
        ttlSeconds: CACHE_CONFIG.ttlSeconds,
        redisAvailable: redisClient.isAvailable(),
        source: useDbStats ? 'postgres' : 'in-memory'
    };
}

/**
 * Resets the cache statistics counters.
 */
function resetCacheStats() {
    cacheStats.hits = 0;
    cacheStats.misses = 0;
    cacheStats.stores = 0;
    cacheStats.invalidations = 0;
    cacheStats.errors = 0;
    console.debug('[CacheService] Statistics reset.');
}

/**
 * Checks if a request should be cached based on its parameters.
 * Streaming requests are not cached.
 * @param {Object} requestBody - The request body
 * @returns {boolean} True if the request can be cached
 */
function shouldCacheRequest(requestBody) {
    // Don't cache streaming requests
    if (requestBody && requestBody.stream === true) {
        return false;
    }

    // Must have cache enabled
    if (!CACHE_CONFIG.enabled) {
        return false;
    }

    return true;
}

/**
 * Checks if a response should be cached based on its status.
 * Only successful (200) responses are cached.
 * @param {number} status - The response status code
 * @returns {boolean} True if the response should be cached
 */
function shouldCacheResponse(status) {
    // Only cache successful responses
    return status === 200;
}

/**
 * Gets the current cache configuration.
 * @returns {Object} The cache configuration
 */
function getConfig() {
    return {
        enabled: CACHE_CONFIG.enabled,
        ttlSeconds: CACHE_CONFIG.ttlSeconds,
        maxSize: CACHE_CONFIG.maxSize
    };
}

// Export the cache service API as a singleton
const cacheService = {
    getCachedResponse,
    cacheResponse,
    generateCacheKey,
    generateCacheKeyFromRequest,
    extractMessagesForCacheKey,
    invalidateModel,
    clearCache,
    getCacheStats,
    resetCacheStats,
    shouldCacheRequest,
    shouldCacheResponse,
    getConfig,
    isCacheAvailable
};

export default cacheService;

// Named exports for convenience
export {
    getCachedResponse,
    cacheResponse,
    generateCacheKey,
    generateCacheKeyFromRequest,
    extractMessagesForCacheKey,
    invalidateModel,
    clearCache,
    getCacheStats,
    resetCacheStats,
    shouldCacheRequest,
    shouldCacheResponse,
    getConfig,
    isCacheAvailable
};
