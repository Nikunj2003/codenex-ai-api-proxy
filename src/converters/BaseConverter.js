/**
 * Base Converter Class
 * Uses strategy pattern to define common interface for converters
 */

/**
 * Abstract base converter class
 * All concrete protocol converters should inherit from this class
 */
export class BaseConverter {
    constructor(protocolName) {
        if (new.target === BaseConverter) {
            throw new Error('BaseConverter is an abstract class and cannot be instantiated directly');
        }
        this.protocolName = protocolName;
    }

    /**
     * Convert request
     * @param {Object} data - Request data
     * @param {string} targetProtocol - Target protocol
     * @returns {Object} Converted request
     */
    convertRequest(data, targetProtocol) {
        throw new Error('convertRequest method must be implemented by subclass');
    }

    /**
     * Convert response
     * @param {Object} data - Response data
     * @param {string} targetProtocol - Target protocol
     * @param {string} model - Model name
     * @returns {Object} Converted response
     */
    convertResponse(data, targetProtocol, model) {
        throw new Error('convertResponse method must be implemented by subclass');
    }

    /**
     * Convert stream response chunk
     * @param {Object} chunk - Stream response chunk
     * @param {string} targetProtocol - Target protocol
     * @param {string} model - Model name
     * @returns {Object} Converted stream response chunk
     */
    convertStreamChunk(chunk, targetProtocol, model) {
        throw new Error('convertStreamChunk method must be implemented by subclass');
    }

    /**
     * Convert model list
     * @param {Object} data - Model list data
     * @param {string} targetProtocol - Target protocol
     * @returns {Object} Converted model list
     */
    convertModelList(data, targetProtocol) {
        throw new Error('convertModelList method must be implemented by subclass');
    }

    /**
     * Get protocol name
     * @returns {string} Protocol name
     */
    getProtocolName() {
        return this.protocolName;
    }
}

/**
 * Content processor interface
 * Used to process different types of content (text, images, audio, etc.)
 */
export class ContentProcessor {
    /**
     * Process content
     * @param {*} content - Content data
     * @returns {*} Processed content
     */
    process(content) {
        throw new Error('process method must be implemented by subclass');
    }
}

/**
 * Tool processor interface
 * Used to handle tool call related conversions
 */
export class ToolProcessor {
    /**
     * Process tool definitions
     * @param {Array} tools - Tool definitions array
     * @returns {Array} Processed tool definitions
     */
    processToolDefinitions(tools) {
        throw new Error('processToolDefinitions method must be implemented by subclass');
    }

    /**
     * Process tool call
     * @param {Object} toolCall - Tool call data
     * @returns {Object} Processed tool call
     */
    processToolCall(toolCall) {
        throw new Error('processToolCall method must be implemented by subclass');
    }

    /**
     * Process tool result
     * @param {Object} toolResult - Tool result data
     * @returns {Object} Processed tool result
     */
    processToolResult(toolResult) {
        throw new Error('processToolResult method must be implemented by subclass');
    }
}