/**
 * Converter Factory Class
 * Uses factory pattern to manage converter instance creation and caching
 */

import { MODEL_PROTOCOL_PREFIX } from '../common.js';

/**
 * Converter Factory (Singleton Pattern + Factory Pattern)
 */
export class ConverterFactory {
    // Private static property: stores converter instances
    static #converters = new Map();

    // Private static property: stores converter classes
    static #converterClasses = new Map();

    /**
     * Register converter class
     * @param {string} protocolPrefix - Protocol prefix
     * @param {Class} ConverterClass - Converter class
     */
    static registerConverter(protocolPrefix, ConverterClass) {
        this.#converterClasses.set(protocolPrefix, ConverterClass);
    }

    /**
     * Get converter instance (with caching)
     * @param {string} protocolPrefix - Protocol prefix
     * @returns {BaseConverter} Converter instance
     */
    static getConverter(protocolPrefix) {
        // Check cache
        if (this.#converters.has(protocolPrefix)) {
            return this.#converters.get(protocolPrefix);
        }

        // Create new instance
        const converter = this.createConverter(protocolPrefix);

        // Cache instance
        if (converter) {
            this.#converters.set(protocolPrefix, converter);
        }

        return converter;
    }

    /**
     * Create converter instance
     * @param {string} protocolPrefix - Protocol prefix
     * @returns {BaseConverter} Converter instance
     */
    static createConverter(protocolPrefix) {
        const ConverterClass = this.#converterClasses.get(protocolPrefix);
        
        if (!ConverterClass) {
            throw new Error(`No converter registered for protocol: ${protocolPrefix}`);
        }

        return new ConverterClass();
    }

    /**
     * Clear all cached converters
     */
    static clearCache() {
        this.#converters.clear();
    }

    /**
     * Clear converter cache for specific protocol
     * @param {string} protocolPrefix - Protocol prefix
     */
    static clearConverterCache(protocolPrefix) {
        this.#converters.delete(protocolPrefix);
    }

    /**
     * Get all registered protocols
     * @returns {Array<string>} Protocol prefix array
     */
    static getRegisteredProtocols() {
        return Array.from(this.#converterClasses.keys());
    }

    /**
     * Check if protocol is registered
     * @param {string} protocolPrefix - Protocol prefix
     * @returns {boolean} Whether registered
     */
    static isProtocolRegistered(protocolPrefix) {
        return this.#converterClasses.has(protocolPrefix);
    }
}

/**
 * Content Processor Factory
 */
export class ContentProcessorFactory {
    static #processors = new Map();

    /**
     * Get content processor
     * @param {string} sourceFormat - Source format
     * @param {string} targetFormat - Target format
     * @returns {ContentProcessor} Content processor instance
     */
    static getProcessor(sourceFormat, targetFormat) {
        const key = `${sourceFormat}_to_${targetFormat}`;
        
        if (!this.#processors.has(key)) {
            this.#processors.set(key, this.createProcessor(sourceFormat, targetFormat));
        }
        
        return this.#processors.get(key);
    }

    /**
     * Create content processor
     * @param {string} sourceFormat - Source format
     * @param {string} targetFormat - Target format
     * @returns {ContentProcessor} Content processor instance
     */
    static createProcessor(sourceFormat, targetFormat) {
        // Returns null here, actual usage requires importing specific processor classes
        // To avoid circular dependencies, processor classes should be dynamically imported when used
        console.warn(`Content processor for ${sourceFormat} to ${targetFormat} not yet implemented`);
        return null;
    }

    /**
     * Clear all cached processors
     */
    static clearCache() {
        this.#processors.clear();
    }
}

/**
 * Tool Processor Factory
 */
export class ToolProcessorFactory {
    static #processors = new Map();

    /**
     * Get tool processor
     * @param {string} sourceFormat - Source format
     * @param {string} targetFormat - Target format
     * @returns {ToolProcessor} Tool processor instance
     */
    static getProcessor(sourceFormat, targetFormat) {
        const key = `${sourceFormat}_to_${targetFormat}`;
        
        if (!this.#processors.has(key)) {
            this.#processors.set(key, this.createProcessor(sourceFormat, targetFormat));
        }
        
        return this.#processors.get(key);
    }

    /**
     * Create tool processor
     * @param {string} sourceFormat - Source format
     * @param {string} targetFormat - Target format
     * @returns {ToolProcessor} Tool processor instance
     */
    static createProcessor(sourceFormat, targetFormat) {
        console.warn(`Tool processor for ${sourceFormat} to ${targetFormat} not yet implemented`);
        return null;
    }

    /**
     * Clear all cached processors
     */
    static clearCache() {
        this.#processors.clear();
    }
}

// Export factory class
export default ConverterFactory;