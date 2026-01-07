/**
 * Provider Utilities Module
 * Contains utility functions shared by ui-manager.js and service-manager.js
 */

import * as path from 'path';
import { promises as fs } from 'fs';

/**
 * Provider directory mapping configuration
 * Defines the mapping relationship from directory names to provider types
 */
export const PROVIDER_MAPPINGS = [
    {
        // Gemini CLI OAuth configuration
        dirName: 'gemini',
        patterns: ['configs/gemini/', '/gemini/', 'configs/gemini-cli/'],
        providerType: 'gemini-cli-oauth',
        credPathKey: 'GEMINI_OAUTH_CREDS_FILE_PATH',
        defaultCheckModel: 'gemini-2.5-flash',
        displayName: 'Gemini CLI OAuth',
        needsProjectId: true,
        urlKeys: ['GEMINI_BASE_URL']
    },
    {
        // Antigravity OAuth configuration
        dirName: 'antigravity',
        patterns: ['configs/antigravity/', '/antigravity/'],
        providerType: 'gemini-antigravity',
        credPathKey: 'ANTIGRAVITY_OAUTH_CREDS_FILE_PATH',
        defaultCheckModel: 'gemini-2.5-computer-use-preview-10-2025',
        displayName: 'Gemini Antigravity',
        needsProjectId: true,
        urlKeys: ['ANTIGRAVITY_BASE_URL_DAILY', 'ANTIGRAVITY_BASE_URL_AUTOPUSH']
    }
];

/**
 * Generates UUID
 * @returns {string} UUID string
 */
export function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

/**
 * Normalizes path for cross-platform compatibility
 * @param {string} filePath - File path
 * @returns {string} Normalized path using forward slashes
 */
export function normalizePath(filePath) {
    if (!filePath) return filePath;
    
    // Normalize using path module, then convert to forward slashes
    const normalized = path.normalize(filePath);
    return normalized.replace(/\\/g, '/');
}

/**
 * Extracts filename from path
 * @param {string} filePath - File path
 * @returns {string} Filename
 */
export function getFileName(filePath) {
    return path.basename(filePath);
}

/**
 * Formats relative path to current system's path format
 * @param {string} relativePath - Relative path
 * @returns {string} Formatted path (with ./ or .\ prefix)
 */
export function formatSystemPath(relativePath) {
    if (!relativePath) return relativePath;

    // Determine path separator based on operating system
    const isWindows = process.platform === 'win32';
    const separator = isWindows ? '\\' : '/';
    // Uniformly convert path separators to current system's separator
    const systemPath = relativePath.replace(/[\/\\]/g, separator);
    return systemPath.startsWith('.' + separator) ? systemPath : '.' + separator + systemPath;
}

/**
 * Checks if two paths point to the same file (cross-platform compatible)
 * @param {string} path1 - First path
 * @param {string} path2 - Second path
 * @returns {boolean} Returns true if paths point to the same file
 */
export function pathsEqual(path1, path2) {
    if (!path1 || !path2) return false;
    
    try {
        // Normalize both paths
        const normalized1 = normalizePath(path1);
        const normalized2 = normalizePath(path2);

        // Direct match
        if (normalized1 === normalized2) {
            return true;
        }

        // Compare after removing leading './'
        const clean1 = normalized1.replace(/^\.\//, '');
        const clean2 = normalized2.replace(/^\.\//, '');

        if (clean1 === clean2) {
            return true;
        }

        // Check if one is a subset of the other (for relative vs absolute path comparison)
        if (normalized1.endsWith('/' + clean2) || normalized2.endsWith('/' + clean1)) {
            return true;
        }

        return false;
    } catch (error) {
        console.warn(`[Path Comparison] Error comparing paths: ${path1} vs ${path2}`, error.message);
        return false;
    }
}

/**
 * Checks if file path is currently in use (cross-platform compatible)
 * @param {string} relativePath - Relative path
 * @param {string} fileName - Filename
 * @param {Set} usedPaths - Set of used paths
 * @returns {boolean} Returns true if file is currently in use
 */
export function isPathUsed(relativePath, fileName, usedPaths) {
    if (!relativePath) return false;

    // Normalize relative path
    const normalizedRelativePath = normalizePath(relativePath);
    const cleanRelativePath = normalizedRelativePath.replace(/^\.\//, '');

    // Get filename from relative path
    const relativeFileName = getFileName(normalizedRelativePath);

    // Iterate through all used paths for matching
    for (const usedPath of usedPaths) {
        if (!usedPath) continue;

        // 1. Direct path match
        if (pathsEqual(relativePath, usedPath) || pathsEqual(relativePath, './' + usedPath)) {
            return true;
        }

        // 2. Normalized path match
        if (pathsEqual(normalizedRelativePath, usedPath) ||
            pathsEqual(normalizedRelativePath, './' + usedPath)) {
            return true;
        }

        // 3. Cleaned path match
        if (pathsEqual(cleanRelativePath, usedPath) ||
            pathsEqual(cleanRelativePath, './' + usedPath)) {
            return true;
        }

        // 4. Filename match (ensure no false matches)
        const usedFileName = getFileName(usedPath);
        if (usedFileName === fileName || usedFileName === relativeFileName) {
            // Ensure files are in the same directory
            const usedDir = path.dirname(usedPath);
            const relativeDir = path.dirname(normalizedRelativePath);

            if (pathsEqual(usedDir, relativeDir) ||
                pathsEqual(usedDir, cleanRelativePath.replace(/\/[^\/]+$/, '')) ||
                pathsEqual(relativeDir.replace(/^\.\//, ''), usedDir.replace(/^\.\//, ''))) {
                return true;
            }
        }

        // 5. Absolute path match (Windows and Unix)
        try {
            const resolvedUsedPath = path.resolve(usedPath);
            const resolvedRelativePath = path.resolve(relativePath);

            if (resolvedUsedPath === resolvedRelativePath) {
                return true;
            }
        } catch (error) {
            // Ignore path resolution errors
        }
    }

    return false;
}

/**
 * Detects provider type based on file path
 * @param {string} normalizedPath - Normalized file path (lowercase, forward slashes)
 * @returns {Object|null} Provider mapping object, or null if not detected
 */
export function detectProviderFromPath(normalizedPath) {
    // Iterate through mappings to find matching provider
    for (const mapping of PROVIDER_MAPPINGS) {
        for (const pattern of mapping.patterns) {
            if (normalizedPath.includes(pattern)) {
                return {
                    providerType: mapping.providerType,
                    credPathKey: mapping.credPathKey,
                    defaultCheckModel: mapping.defaultCheckModel,
                    displayName: mapping.displayName,
                    needsProjectId: mapping.needsProjectId
                };
            }
        }
    }

    return null;
}

/**
 * Gets provider mapping by directory name
 * @param {string} dirName - Directory name
 * @returns {Object|null} Provider mapping object, or null if not found
 */
export function getProviderMappingByDirName(dirName) {
    return PROVIDER_MAPPINGS.find(m => m.dirName === dirName) || null;
}

/**
 * Validates whether a file is a valid OAuth credentials file
 * @param {string} filePath - File path
 * @returns {Promise<boolean>} Whether valid
 */
export async function isValidOAuthCredentials(filePath) {
    try {
        const content = await fs.readFile(filePath, 'utf8');
        const jsonData = JSON.parse(content);

        // Check if it contains OAuth-related fields
        // Credentials typically contain access_token/accessToken, refresh_token/refreshToken, client_id, etc.
        // Supports both underscore naming (access_token) and camelCase naming (accessToken) formats
        if (jsonData.access_token || jsonData.refresh_token ||
            jsonData.accessToken || jsonData.refreshToken ||
            jsonData.client_id || jsonData.client_secret ||
            jsonData.token || jsonData.credentials) {
            return true;
        }

        // May also be a credentials file with nested structure
        if (jsonData.installed || jsonData.web) {
            return true;
        }

        return false;
    } catch (error) {
        // If unable to parse, consider it not a valid credentials file
        return false;
    }
}

/**
 * Creates a new provider configuration object
 * @param {Object} options - Configuration options
 * @param {string} options.credPathKey - Credentials path key name
 * @param {string} options.credPath - Credentials file path
 * @param {string} options.defaultCheckModel - Default check model
 * @param {boolean} options.needsProjectId - Whether PROJECT_ID is needed
 * @param {Array} options.urlKeys - Optional list of URL configuration key names
 * @returns {Object} New provider configuration object
 */
export function createProviderConfig(options) {
    const { credPathKey, credPath, defaultCheckModel, needsProjectId, urlKeys } = options;
    
    const newProvider = {
        [credPathKey]: credPath,
        uuid: generateUUID(),
        checkModelName: defaultCheckModel,
        checkHealth: false,
        isHealthy: true,
        isDisabled: false,
        lastUsed: null,
        usageCount: 0,
        errorCount: 0,
        lastErrorTime: null,
        lastHealthCheckTime: null,
        lastHealthCheckModel: null,
        lastErrorMessage: null
    };

    // If PROJECT_ID is needed, add empty string placeholder
    if (needsProjectId) {
        newProvider.PROJECT_ID = '';
    }

    // Initialize optional URL configuration items
    if (urlKeys && Array.isArray(urlKeys)) {
        urlKeys.forEach(key => {
            newProvider[key] = '';
        });
    }

    return newProvider;
}

/**
 * Adds path to used paths set (normalizes multiple formats)
 * @param {Set} usedPaths - Set of used paths
 * @param {string} filePath - File path to add
 */
export function addToUsedPaths(usedPaths, filePath) {
    if (!filePath) return;
    
    const normalizedPath = filePath.replace(/\\/g, '/');
    usedPaths.add(filePath);
    usedPaths.add(normalizedPath);
    if (normalizedPath.startsWith('./')) {
        usedPaths.add(normalizedPath.slice(2));
    } else {
        usedPaths.add('./' + normalizedPath);
    }
}

/**
 * Checks if path is already linked (for auto-link detection)
 * @param {string} relativePath - Relative path
 * @param {Set} linkedPaths - Set of linked paths
 * @returns {boolean} Whether linked
 */
export function isPathLinked(relativePath, linkedPaths) {
    return linkedPaths.has(relativePath) ||
           linkedPaths.has('./' + relativePath) ||
           linkedPaths.has(relativePath.replace(/^\.\//, ''));
}