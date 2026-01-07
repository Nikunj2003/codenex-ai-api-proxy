/**
 * Protocol Conversion Module - New Architecture Version
 * Uses the refactored converter architecture
 *
 * This file demonstrates how to use the new converter architecture
 * Can gradually replace the original convert.js
 */

import { v4 as uuidv4 } from 'uuid';
import { MODEL_PROTOCOL_PREFIX, getProtocolPrefix } from './common.js';
import { ConverterFactory } from './converters/ConverterFactory.js';
import {
    generateResponseCreated,
    generateResponseInProgress,
    generateOutputItemAdded,
    generateContentPartAdded,
    generateOutputTextDone,
    generateContentPartDone,
    generateOutputItemDone,
    generateResponseCompleted
} from './openai/openai-responses-core.mjs';

// =============================================================================
// Initialization: Register all converters
// =============================================================================

// =============================================================================
// Main Conversion Functions
// =============================================================================

/**
 * Generic data conversion function (new architecture version)
 * @param {object} data - Data to convert (request body or response)
 * @param {string} type - Conversion type: 'request', 'response', 'streamChunk', 'modelList'
 * @param {string} fromProvider - Source model provider
 * @param {string} toProvider - Target model provider
 * @param {string} [model] - Optional model name (used for response conversion)
 * @returns {object} Converted data
 * @throws {Error} If no suitable conversion function is found
 */
export function convertData(data, type, fromProvider, toProvider, model) {
    try {
        // Get protocol prefix
        const fromProtocol = getProtocolPrefix(fromProvider);
        const toProtocol = getProtocolPrefix(toProvider);

        // Get converter from factory
        const converter = ConverterFactory.getConverter(fromProtocol);

        if (!converter) {
            throw new Error(`No converter found for protocol: ${fromProtocol}`);
        }

        // Call corresponding conversion method based on type
        switch (type) {
            case 'request':
                return converter.convertRequest(data, toProtocol);
                
            case 'response':
                return converter.convertResponse(data, toProtocol, model);
                
            case 'streamChunk':
                return converter.convertStreamChunk(data, toProtocol, model);
                
            case 'modelList':
                return converter.convertModelList(data, toProtocol);
                
            default:
                throw new Error(`Unsupported conversion type: ${type}`);
        }
    } catch (error) {
        console.error(`Conversion error: ${error.message}`);
        throw error;
    }
}

// =============================================================================
// Backward Compatible Export Functions
// =============================================================================

/**
 * The following functions maintain compatibility with the original API
 * Internally using the new converter architecture
 */

// OpenAI related conversions
export function toOpenAIRequestFromGemini(geminiRequest) {
    const converter = ConverterFactory.getConverter(MODEL_PROTOCOL_PREFIX.GEMINI);
    return converter.toOpenAIRequest(geminiRequest);
}

export function toOpenAIRequestFromClaude(claudeRequest) {
    const converter = ConverterFactory.getConverter(MODEL_PROTOCOL_PREFIX.CLAUDE);
    return converter.toOpenAIRequest(claudeRequest);
}

export function toOpenAIChatCompletionFromGemini(geminiResponse, model) {
    const converter = ConverterFactory.getConverter(MODEL_PROTOCOL_PREFIX.GEMINI);
    return converter.toOpenAIResponse(geminiResponse, model);
}

export function toOpenAIChatCompletionFromClaude(claudeResponse, model) {
    const converter = ConverterFactory.getConverter(MODEL_PROTOCOL_PREFIX.CLAUDE);
    return converter.toOpenAIResponse(claudeResponse, model);
}

export function toOpenAIStreamChunkFromGemini(geminiChunk, model) {
    const converter = ConverterFactory.getConverter(MODEL_PROTOCOL_PREFIX.GEMINI);
    return converter.toOpenAIStreamChunk(geminiChunk, model);
}

export function toOpenAIStreamChunkFromClaude(claudeChunk, model) {
    const converter = ConverterFactory.getConverter(MODEL_PROTOCOL_PREFIX.CLAUDE);
    return converter.toOpenAIStreamChunk(claudeChunk, model);
}

export function toOpenAIModelListFromGemini(geminiModels) {
    const converter = ConverterFactory.getConverter(MODEL_PROTOCOL_PREFIX.GEMINI);
    return converter.toOpenAIModelList(geminiModels);
}

export function toOpenAIModelListFromClaude(claudeModels) {
    const converter = ConverterFactory.getConverter(MODEL_PROTOCOL_PREFIX.CLAUDE);
    return converter.toOpenAIModelList(claudeModels);
}

// Claude related conversions
export function toClaudeRequestFromOpenAI(openaiRequest) {
    const converter = ConverterFactory.getConverter(MODEL_PROTOCOL_PREFIX.OPENAI);
    return converter.toClaudeRequest(openaiRequest);
}

export function toClaudeRequestFromOpenAIResponses(responsesRequest) {
    const converter = ConverterFactory.getConverter(MODEL_PROTOCOL_PREFIX.OPENAI_RESPONSES);
    return converter.toClaudeRequest(responsesRequest);
}

export function toClaudeChatCompletionFromOpenAI(openaiResponse, model) {
    const converter = ConverterFactory.getConverter(MODEL_PROTOCOL_PREFIX.OPENAI);
    return converter.toClaudeResponse(openaiResponse, model);
}

export function toClaudeChatCompletionFromGemini(geminiResponse, model) {
    const converter = ConverterFactory.getConverter(MODEL_PROTOCOL_PREFIX.GEMINI);
    return converter.toClaudeResponse(geminiResponse, model);
}

export function toClaudeStreamChunkFromOpenAI(openaiChunk, model) {
    const converter = ConverterFactory.getConverter(MODEL_PROTOCOL_PREFIX.OPENAI);
    return converter.toClaudeStreamChunk(openaiChunk, model);
}

export function toClaudeStreamChunkFromGemini(geminiChunk, model) {
    const converter = ConverterFactory.getConverter(MODEL_PROTOCOL_PREFIX.GEMINI);
    return converter.toClaudeStreamChunk(geminiChunk, model);
}

export function toClaudeModelListFromOpenAI(openaiModels) {
    const converter = ConverterFactory.getConverter(MODEL_PROTOCOL_PREFIX.OPENAI);
    return converter.toClaudeModelList(openaiModels);
}

export function toClaudeModelListFromGemini(geminiModels) {
    const converter = ConverterFactory.getConverter(MODEL_PROTOCOL_PREFIX.GEMINI);
    return converter.toClaudeModelList(geminiModels);
}

// Gemini related conversions
export function toGeminiRequestFromOpenAI(openaiRequest) {
    const converter = ConverterFactory.getConverter(MODEL_PROTOCOL_PREFIX.OPENAI);
    return converter.toGeminiRequest(openaiRequest);
}

export function toGeminiRequestFromClaude(claudeRequest) {
    const converter = ConverterFactory.getConverter(MODEL_PROTOCOL_PREFIX.CLAUDE);
    return converter.toGeminiRequest(claudeRequest);
}

export function toGeminiRequestFromOpenAIResponses(responsesRequest) {
    const converter = ConverterFactory.getConverter(MODEL_PROTOCOL_PREFIX.OPENAI_RESPONSES);
    return converter.toGeminiRequest(responsesRequest);
}

// OpenAI Responses related conversions
export function toOpenAIResponsesFromOpenAI(openaiResponse, model) {
    const converter = ConverterFactory.getConverter(MODEL_PROTOCOL_PREFIX.OPENAI);
    return converter.toOpenAIResponsesResponse(openaiResponse, model);
}

export function toOpenAIResponsesFromClaude(claudeResponse, model) {
    const converter = ConverterFactory.getConverter(MODEL_PROTOCOL_PREFIX.CLAUDE);
    return converter.toOpenAIResponsesResponse(claudeResponse, model);
}

export function toOpenAIResponsesFromGemini(geminiResponse, model) {
    const converter = ConverterFactory.getConverter(MODEL_PROTOCOL_PREFIX.GEMINI);
    return converter.toOpenAIResponsesResponse(geminiResponse, model);
}

export function toOpenAIResponsesStreamChunkFromOpenAI(openaiChunk, model, requestId) {
    const converter = ConverterFactory.getConverter(MODEL_PROTOCOL_PREFIX.OPENAI);
    return converter.toOpenAIResponsesStreamChunk(openaiChunk, model, requestId);
}

export function toOpenAIResponsesStreamChunkFromClaude(claudeChunk, model, requestId) {
    const converter = ConverterFactory.getConverter(MODEL_PROTOCOL_PREFIX.CLAUDE);
    return converter.toOpenAIResponsesStreamChunk(claudeChunk, model, requestId);
}

export function toOpenAIResponsesStreamChunkFromGemini(geminiChunk, model, requestId) {
    const converter = ConverterFactory.getConverter(MODEL_PROTOCOL_PREFIX.GEMINI);
    return converter.toOpenAIResponsesStreamChunk(geminiChunk, model, requestId);
}

// Convert from OpenAI Responses to other formats
export function toOpenAIRequestFromOpenAIResponses(responsesRequest) {
    const converter = ConverterFactory.getConverter(MODEL_PROTOCOL_PREFIX.OPENAI_RESPONSES);
    return converter.toOpenAIRequest(responsesRequest);
}

export function toOpenAIChatCompletionFromOpenAIResponses(responsesResponse, model) {
    const converter = ConverterFactory.getConverter(MODEL_PROTOCOL_PREFIX.OPENAI_RESPONSES);
    return converter.toOpenAIResponse(responsesResponse, model);
}

export function toOpenAIStreamChunkFromOpenAIResponses(responsesChunk, model) {
    const converter = ConverterFactory.getConverter(MODEL_PROTOCOL_PREFIX.OPENAI_RESPONSES);
    return converter.toOpenAIStreamChunk(responsesChunk, model);
}

// Helper function exports
export async function extractAndProcessSystemMessages(messages) {
    const { Utils } = await import('./converters/utils.js');
    return Utils.extractSystemMessages(messages);
}

export async function extractTextFromMessageContent(content) {
    const { Utils } = await import('./converters/utils.js');
    return Utils.extractText(content);
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Get all registered protocols
 * @returns {Array<string>} Array of protocol prefixes
 */
export function getRegisteredProtocols() {
    return ConverterFactory.getRegisteredProtocols();
}

/**
 * Check if a protocol is registered
 * @param {string} protocol - Protocol prefix
 * @returns {boolean} Whether registered
 */
export function isProtocolRegistered(protocol) {
    return ConverterFactory.isProtocolRegistered(protocol);
}

/**
 * Clear all converter cache
 */
export function clearConverterCache() {
    ConverterFactory.clearCache();
}

/**
 * Get converter instance (for advanced usage)
 * @param {string} protocol - Protocol prefix
 * @returns {BaseConverter} Converter instance
 */
export function getConverter(protocol) {
    return ConverterFactory.getConverter(protocol);
}

// =============================================================================
// Helper Functions - Migrated from original convert.js
// =============================================================================

/**
 * Generate OpenAI stream response stop chunk
 * @param {string} model - Model name
 * @returns {Object} OpenAI stream stop chunk
 */
export function getOpenAIStreamChunkStop(model) {
    return {
        id: `chatcmpl-${uuidv4()}`,
        object: "chat.completion.chunk",
        created: Math.floor(Date.now() / 1000),
        model: model,
        system_fingerprint: "",
        choices: [{
            index: 0,
            delta: {
                content: "",
                reasoning_content: ""
            },
            finish_reason: 'stop',
            message: {
                content: "",
                reasoning_content: ""
            }
        }],
        usage:{
            prompt_tokens: 0,
            completion_tokens: 0,
            total_tokens: 0,
        },
    };
}

/**
 * Generate OpenAI Responses stream response start events
 * @param {string} id - Response ID
 * @param {string} model - Model name
 * @returns {Array} Array of start events
 */
export function getOpenAIResponsesStreamChunkBegin(id, model) {
    return [
        generateResponseCreated(id, model),
        generateResponseInProgress(id),
        generateOutputItemAdded(id),
        generateContentPartAdded(id)
    ];
}

/**
 * Generate OpenAI Responses stream response end events
 * @param {string} id - Response ID
 * @returns {Array} Array of end events
 */
export function getOpenAIResponsesStreamChunkEnd(id) {
    return [
        generateOutputTextDone(id),
        generateContentPartDone(id),
        generateOutputItemDone(id),
        generateResponseCompleted(id)
    ];
}

// =============================================================================
// Default Export
// =============================================================================

export default {
    convertData,
    getRegisteredProtocols,
    isProtocolRegistered,
    clearConverterCache,
    getConverter,
    // Backward compatible functions
    toOpenAIRequestFromGemini,
    toOpenAIRequestFromClaude,
    toOpenAIChatCompletionFromGemini,
    toOpenAIChatCompletionFromClaude,
    toOpenAIStreamChunkFromGemini,
    toOpenAIStreamChunkFromClaude,
    toOpenAIModelListFromGemini,
    toOpenAIModelListFromClaude,
    toClaudeRequestFromOpenAI,
    toClaudeChatCompletionFromOpenAI,
    toClaudeChatCompletionFromGemini,
    toClaudeStreamChunkFromOpenAI,
    toClaudeStreamChunkFromGemini,
    toClaudeModelListFromOpenAI,
    toClaudeModelListFromGemini,
    toGeminiRequestFromOpenAI,
    toGeminiRequestFromClaude,
    toOpenAIResponsesFromOpenAI,
    toOpenAIResponsesFromClaude,
    toOpenAIResponsesFromGemini,
    toOpenAIResponsesStreamChunkFromOpenAI,
    toOpenAIResponsesStreamChunkFromClaude,
    toOpenAIResponsesStreamChunkFromGemini,
    toOpenAIRequestFromOpenAIResponses,
    toOpenAIChatCompletionFromOpenAIResponses,
    toOpenAIStreamChunkFromOpenAIResponses,
    toClaudeRequestFromOpenAIResponses,
    toGeminiRequestFromOpenAIResponses,
};