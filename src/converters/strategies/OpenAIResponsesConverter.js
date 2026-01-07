/**
 * OpenAI Responses API Converter
 * Handles conversion between OpenAI Responses API format and other protocols
 */

import { BaseConverter } from '../BaseConverter.js';
import { MODEL_PROTOCOL_PREFIX } from '../../common.js';
import {
    extractAndProcessSystemMessages as extractSystemMessages,
    extractTextFromMessageContent as extractText,
    CLAUDE_DEFAULT_MAX_TOKENS,
    GEMINI_DEFAULT_INPUT_TOKEN_LIMIT,
    GEMINI_DEFAULT_OUTPUT_TOKEN_LIMIT,
    GEMINI_MAX_OUTPUT_TOKENS_LIMIT
} from '../utils.js';

/**
 * OpenAI Responses API Converter Class
 * Supports conversion between OpenAI Responses format and OpenAI, Claude, Gemini protocols
 */
export class OpenAIResponsesConverter extends BaseConverter {
    constructor() {
        super(MODEL_PROTOCOL_PREFIX.OPENAI_RESPONSES);
    }

    // =============================================================================
    // Request Conversion
    // =============================================================================

    /**
     * Convert request to target protocol
     */
    convertRequest(data, toProtocol) {
        switch (toProtocol) {
            case MODEL_PROTOCOL_PREFIX.OPENAI:
                return this.toOpenAIRequest(data);
            case MODEL_PROTOCOL_PREFIX.CLAUDE:
                return this.toClaudeRequest(data);
            case MODEL_PROTOCOL_PREFIX.GEMINI:
                return this.toGeminiRequest(data);
            default:
                throw new Error(`Unsupported target protocol: ${toProtocol}`);
        }
    }

    /**
     * Convert response to target protocol
     */
    convertResponse(data, toProtocol, model) {
        switch (toProtocol) {
            case MODEL_PROTOCOL_PREFIX.OPENAI:
                return this.toOpenAIResponse(data, model);
            case MODEL_PROTOCOL_PREFIX.CLAUDE:
                return this.toClaudeResponse(data, model);
            case MODEL_PROTOCOL_PREFIX.GEMINI:
                return this.toGeminiResponse(data, model);
            default:
                throw new Error(`Unsupported target protocol: ${toProtocol}`);
        }
    }

    /**
     * Convert stream response chunk to target protocol
     */
    convertStreamChunk(chunk, toProtocol, model) {
        switch (toProtocol) {
            case MODEL_PROTOCOL_PREFIX.OPENAI:
                return this.toOpenAIStreamChunk(chunk, model);
            case MODEL_PROTOCOL_PREFIX.CLAUDE:
                return this.toClaudeStreamChunk(chunk, model);
            case MODEL_PROTOCOL_PREFIX.GEMINI:
                return this.toGeminiStreamChunk(chunk, model);
            default:
                throw new Error(`Unsupported target protocol: ${toProtocol}`);
        }
    }

    /**
     * Convert model list to target protocol
     */
    convertModelList(data, targetProtocol) {
        switch (targetProtocol) {
            case MODEL_PROTOCOL_PREFIX.OPENAI:
                return this.toOpenAIModelList(data);
            case MODEL_PROTOCOL_PREFIX.CLAUDE:
                return this.toClaudeModelList(data);
            case MODEL_PROTOCOL_PREFIX.GEMINI:
                return this.toGeminiModelList(data);
            default:
                return data;
        }
    }

    // =============================================================================
    // Convert to OpenAI Format
    // =============================================================================

    /**
     * Convert OpenAI Responses request to standard OpenAI request
     */
    toOpenAIRequest(responsesRequest) {
        const openaiRequest = {
            model: responsesRequest.model,
            messages: [],
            stream: responsesRequest.stream || false
        };

        // OpenAI Responses API uses instructions and input fields
        // Need to convert to standard messages format
        if (responsesRequest.instructions) {
            // instructions as system message
            openaiRequest.messages.push({
                role: 'system',
                content: responsesRequest.instructions
            });
        }

        // Handle input as simple string
        if (responsesRequest.input && typeof responsesRequest.input === 'string') {
            openaiRequest.messages.push({
                role: 'user',
                content: responsesRequest.input
            });
        }
        // input contains user messages and conversation history
        else if (responsesRequest.input && Array.isArray(responsesRequest.input)) {
            responsesRequest.input.forEach(item => {
                if (item.type === 'message') {
                    // Extract message content
                    const content = item.content
                        .filter(c => c.type === 'input_text')
                        .map(c => c.text)
                        .join('\n');

                    if (content) {
                        openaiRequest.messages.push({
                            role: item.role,
                            content: content
                        });
                    }
                }
            });
        }

        // Also support standard messages field if present
        if (responsesRequest.messages && Array.isArray(responsesRequest.messages)) {
            responsesRequest.messages.forEach(msg => {
                openaiRequest.messages.push({
                    role: msg.role,
                    content: msg.content
                });
            });
        }

        // Copy other parameters
        if (responsesRequest.temperature !== undefined) {
            openaiRequest.temperature = responsesRequest.temperature;
        }
        if (responsesRequest.max_tokens !== undefined) {
            openaiRequest.max_tokens = responsesRequest.max_tokens;
        }
        if (responsesRequest.top_p !== undefined) {
            openaiRequest.top_p = responsesRequest.top_p;
        }

        return openaiRequest;
    }

    /**
     * Convert OpenAI Responses response to standard OpenAI response
     */
    toOpenAIResponse(responsesResponse, model) {
        // OpenAI Responses format is already close to standard OpenAI format
        return {
            id: responsesResponse.id || `chatcmpl-${Date.now()}`,
            object: 'chat.completion',
            created: responsesResponse.created || Math.floor(Date.now() / 1000),
            model: model || responsesResponse.model,
            choices: responsesResponse.choices || [{
                index: 0,
                message: {
                    role: 'assistant',
                    content: responsesResponse.content || ''
                },
                finish_reason: responsesResponse.finish_reason || 'stop'
            }],
            usage: responsesResponse.usage ? {
                prompt_tokens: responsesResponse.usage.input_tokens || 0,
                completion_tokens: responsesResponse.usage.output_tokens || 0,
                total_tokens: responsesResponse.usage.total_tokens || 0,
                prompt_tokens_details: {
                    cached_tokens: responsesResponse.usage.input_tokens_details?.cached_tokens || 0
                },
                completion_tokens_details: {
                    reasoning_tokens: responsesResponse.usage.output_tokens_details?.reasoning_tokens || 0
                }
            } : {
                prompt_tokens: 0,
                completion_tokens: 0,
                total_tokens: 0,
                prompt_tokens_details: {
                    cached_tokens: 0
                },
                completion_tokens_details: {
                    reasoning_tokens: 0
                }
            }
        };
    }

    /**
     * Convert OpenAI Responses stream chunk to standard OpenAI stream chunk
     */
    toOpenAIStreamChunk(responsesChunk, model) {
        return {
            id: responsesChunk.id || `chatcmpl-${Date.now()}`,
            object: 'chat.completion.chunk',
            created: responsesChunk.created || Math.floor(Date.now() / 1000),
            model: model || responsesChunk.model,
            choices: responsesChunk.choices || [{
                index: 0,
                delta: {
                    content: responsesChunk.delta?.content || ''
                },
                finish_reason: responsesChunk.finish_reason || null
            }]
        };
    }

    // =============================================================================
    // Convert to Claude Format
    // =============================================================================

    /**
     * Convert OpenAI Responses request to Claude request
     */
    toClaudeRequest(responsesRequest) {
        const claudeRequest = {
            model: responsesRequest.model,
            messages: [],
            max_tokens: responsesRequest.max_tokens || CLAUDE_DEFAULT_MAX_TOKENS,
            stream: responsesRequest.stream || false
        };

        // Process instructions as system message
        if (responsesRequest.instructions) {
            claudeRequest.system = responsesRequest.instructions;
        }

        // Handle input as simple string
        if (responsesRequest.input && typeof responsesRequest.input === 'string') {
            claudeRequest.messages.push({
                role: 'user',
                content: responsesRequest.input
            });
        }
        // Process messages in input array
        else if (responsesRequest.input && Array.isArray(responsesRequest.input)) {
            responsesRequest.input.forEach(item => {
                if (item.type === 'message') {
                    const content = item.content
                        .filter(c => c.type === 'input_text')
                        .map(c => c.text)
                        .join('\n');

                    if (content) {
                        claudeRequest.messages.push({
                            role: item.role === 'assistant' ? 'assistant' : 'user',
                            content: content
                        });
                    }
                }
            });
        }

        // Also support standard messages field if present
        if (responsesRequest.messages && Array.isArray(responsesRequest.messages)) {
            const { systemMessages, otherMessages } = extractSystemMessages(
                responsesRequest.messages
            );

            if (!claudeRequest.system && systemMessages.length > 0) {
                const systemTexts = systemMessages.map(msg => extractText(msg.content));
                claudeRequest.system = systemTexts.join('\n');
            }

            otherMessages.forEach(msg => {
                claudeRequest.messages.push({
                    role: msg.role === 'assistant' ? 'assistant' : 'user',
                    content: typeof msg.content === 'string' ? msg.content : extractText(msg.content)
                });
            });
        }

        // Copy other parameters
        if (responsesRequest.temperature !== undefined) {
            claudeRequest.temperature = responsesRequest.temperature;
        }
        if (responsesRequest.top_p !== undefined) {
            claudeRequest.top_p = responsesRequest.top_p;
        }

        return claudeRequest;
    }

    /**
     * Convert OpenAI Responses response to Claude response
     */
    toClaudeResponse(responsesResponse, model) {
        const content = responsesResponse.choices?.[0]?.message?.content || 
                       responsesResponse.content || '';

        return {
            id: responsesResponse.id || `msg_${Date.now()}`,
            type: 'message',
            role: 'assistant',
            content: [{
                type: 'text',
                text: content
            }],
            model: model || responsesResponse.model,
            stop_reason: responsesResponse.choices?.[0]?.finish_reason || 'end_turn',
            usage: {
                input_tokens: responsesResponse.usage?.input_tokens || responsesResponse.usage?.prompt_tokens || 0,
                cache_creation_input_tokens: 0,
                cache_read_input_tokens: responsesResponse.usage?.input_tokens_details?.cached_tokens || 0,
                output_tokens: responsesResponse.usage?.output_tokens || responsesResponse.usage?.completion_tokens || 0,
                prompt_tokens: responsesResponse.usage?.input_tokens || responsesResponse.usage?.prompt_tokens || 0,
                completion_tokens: responsesResponse.usage?.output_tokens || responsesResponse.usage?.completion_tokens || 0,
                total_tokens: responsesResponse.usage?.total_tokens ||
                    ((responsesResponse.usage?.input_tokens || responsesResponse.usage?.prompt_tokens || 0) +
                     (responsesResponse.usage?.output_tokens || responsesResponse.usage?.completion_tokens || 0)),
                cached_tokens: responsesResponse.usage?.input_tokens_details?.cached_tokens || 0
            }
        };
    }

    /**
     * Convert OpenAI Responses stream chunk to Claude stream chunk
     */
    toClaudeStreamChunk(responsesChunk, model) {
        const delta = responsesChunk.choices?.[0]?.delta || responsesChunk.delta || {};
        const finishReason = responsesChunk.choices?.[0]?.finish_reason || 
                           responsesChunk.finish_reason;

        if (finishReason) {
            return {
                type: 'message_stop'
            };
        }

        if (delta.content) {
            return {
                type: 'content_block_delta',
                index: 0,
                delta: {
                    type: 'text_delta',
                    text: delta.content
                }
            };
        }

        return {
            type: 'message_start',
            message: {
                id: responsesChunk.id || `msg_${Date.now()}`,
                type: 'message',
                role: 'assistant',
                content: [],
                model: model || responsesChunk.model
            }
        };
    }

    // =============================================================================
    // Convert to Gemini Format
    // =============================================================================

    /**
     * Convert OpenAI Responses request to Gemini request
     */
    toGeminiRequest(responsesRequest) {
        const geminiRequest = {
            contents: [],
            generationConfig: {}
        };

        // Process instructions as system instruction
        if (responsesRequest.instructions) {
            geminiRequest.systemInstruction = {
                parts: [{
                    text: responsesRequest.instructions
                }]
            };
        }

        // Handle input as simple string
        if (responsesRequest.input && typeof responsesRequest.input === 'string') {
            geminiRequest.contents.push({
                role: 'user',
                parts: [{
                    text: responsesRequest.input
                }]
            });
        }
        // Process messages in input array
        else if (responsesRequest.input && Array.isArray(responsesRequest.input)) {
            responsesRequest.input.forEach(item => {
                // If item has no type property, default to message
                // Or item.type is explicitly message
                if (!item.type || item.type === 'message') {
                    let content = '';
                    if (Array.isArray(item.content)) {
                        content = item.content
                            .filter(c => c.type === 'input_text')
                            .map(c => c.text)
                            .join('\n');
                    } else if (typeof item.content === 'string') {
                        content = item.content;
                    }

                    if (content) {
                        geminiRequest.contents.push({
                            role: item.role === 'assistant' ? 'model' : 'user',
                            parts: [{
                                text: content
                            }]
                        });
                    }
                }
            });
        }

        // Also support standard messages field if present
        if (responsesRequest.messages && Array.isArray(responsesRequest.messages)) {
            const { systemMessages, otherMessages } = extractSystemMessages(
                responsesRequest.messages
            );

            if (!geminiRequest.systemInstruction && systemMessages.length > 0) {
                const systemTexts = systemMessages.map(msg => extractText(msg.content));
                geminiRequest.systemInstruction = {
                    parts: [{
                        text: systemTexts.join('\n')
                    }]
                };
            }

            otherMessages.forEach(msg => {
                geminiRequest.contents.push({
                    role: msg.role === 'assistant' ? 'model' : 'user',
                    parts: [{
                        text: typeof msg.content === 'string' ? msg.content : extractText(msg.content)
                    }]
                });
            });
        }

        // Set generation config
        if (responsesRequest.temperature !== undefined) {
            geminiRequest.generationConfig.temperature = responsesRequest.temperature;
        }
        if (responsesRequest.max_tokens !== undefined) {
            // Cap maxOutputTokens to Gemini's limit (65536)
            geminiRequest.generationConfig.maxOutputTokens = Math.min(
                responsesRequest.max_tokens,
                GEMINI_MAX_OUTPUT_TOKENS_LIMIT
            );
        }
        if (responsesRequest.top_p !== undefined) {
            geminiRequest.generationConfig.topP = responsesRequest.top_p;
        }

        return geminiRequest;
    }

    /**
     * Convert OpenAI Responses response to Gemini response
     */
    toGeminiResponse(responsesResponse, model) {
        const content = responsesResponse.choices?.[0]?.message?.content || 
                       responsesResponse.content || '';

        return {
            candidates: [{
                content: {
                    parts: [{
                        text: content
                    }],
                    role: 'model'
                },
                finishReason: this.mapFinishReason(
                    responsesResponse.choices?.[0]?.finish_reason || 'STOP'
                ),
                index: 0
            }],
            usageMetadata: {
                promptTokenCount: responsesResponse.usage?.input_tokens || responsesResponse.usage?.prompt_tokens || 0,
                candidatesTokenCount: responsesResponse.usage?.output_tokens || responsesResponse.usage?.completion_tokens || 0,
                totalTokenCount: responsesResponse.usage?.total_tokens ||
                    ((responsesResponse.usage?.input_tokens || responsesResponse.usage?.prompt_tokens || 0) +
                     (responsesResponse.usage?.output_tokens || responsesResponse.usage?.completion_tokens || 0)),
                cachedContentTokenCount: responsesResponse.usage?.input_tokens_details?.cached_tokens || 0,
                promptTokensDetails: [{
                    modality: "TEXT",
                    tokenCount: responsesResponse.usage?.input_tokens || responsesResponse.usage?.prompt_tokens || 0
                }],
                candidatesTokensDetails: [{
                    modality: "TEXT",
                    tokenCount: responsesResponse.usage?.output_tokens || responsesResponse.usage?.completion_tokens || 0
                }],
                thoughtsTokenCount: responsesResponse.usage?.output_tokens_details?.reasoning_tokens || 0
            }
        };
    }

    /**
     * Convert OpenAI Responses stream chunk to Gemini stream chunk
     */
    toGeminiStreamChunk(responsesChunk, model) {
        const delta = responsesChunk.choices?.[0]?.delta || responsesChunk.delta || {};
        const finishReason = responsesChunk.choices?.[0]?.finish_reason || 
                           responsesChunk.finish_reason;

        return {
            candidates: [{
                content: {
                    parts: delta.content ? [{
                        text: delta.content
                    }] : [],
                    role: 'model'
                },
                finishReason: finishReason ? this.mapFinishReason(finishReason) : null,
                index: 0
            }]
        };
    }

    // =============================================================================
    // Helper Methods
    // =============================================================================

    /**
     * Map finish reason
     */
    mapFinishReason(reason) {
        const reasonMap = {
            'stop': 'STOP',
            'length': 'MAX_TOKENS',
            'content_filter': 'SAFETY',
            'end_turn': 'STOP'
        };
        return reasonMap[reason] || 'STOP';
    }

    /**
     * Convert OpenAI Responses model list to standard OpenAI model list
     */
    toOpenAIModelList(responsesModels) {
        // OpenAI Responses format model list is already standard OpenAI format
        // If input is already in standard format, return directly
        if (responsesModels.object === 'list' && responsesModels.data) {
            return responsesModels;
        }

        // If in other format, convert to standard format
        return {
            object: "list",
            data: (responsesModels.models || responsesModels.data || []).map(m => ({
                id: m.id || m.name,
                object: "model",
                created: m.created || Math.floor(Date.now() / 1000),
                owned_by: m.owned_by || "openai",
            })),
        };
    }

    /**
     * Convert OpenAI Responses model list to Claude model list
     */
    toClaudeModelList(responsesModels) {
        const models = responsesModels.data || responsesModels.models || [];
        return {
            models: models.map(m => ({
                name: m.id || m.name,
                description: m.description || "",
            })),
        };
    }

    /**
     * Convert OpenAI Responses model list to Gemini model list
     */
    toGeminiModelList(responsesModels) {
        const models = responsesModels.data || responsesModels.models || [];
        return {
            models: models.map(m => ({
                name: `models/${m.id || m.name}`,
                version: m.version || "1.0.0",
                displayName: m.displayName || m.id || m.name,
                description: m.description || `A generative model for text and chat generation. ID: ${m.id || m.name}`,
                inputTokenLimit: m.inputTokenLimit || GEMINI_DEFAULT_INPUT_TOKEN_LIMIT,
                outputTokenLimit: m.outputTokenLimit || GEMINI_DEFAULT_OUTPUT_TOKEN_LIMIT,
                supportedGenerationMethods: m.supportedGenerationMethods || ["generateContent", "streamGenerateContent"]
            }))
        };
    }

}

