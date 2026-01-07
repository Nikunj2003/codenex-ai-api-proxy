/**
 * Claude Converter
 * Handles conversion between Claude (Anthropic) protocol and other protocols
 */

import { v4 as uuidv4 } from 'uuid';
import { BaseConverter } from '../BaseConverter.js';
import {
    checkAndAssignOrDefault,
    cleanJsonSchemaProperties as cleanJsonSchema,
    determineReasoningEffortFromBudget,
    OPENAI_DEFAULT_MAX_TOKENS,
    OPENAI_DEFAULT_TEMPERATURE,
    OPENAI_DEFAULT_TOP_P,
    GEMINI_DEFAULT_MAX_TOKENS,
    GEMINI_DEFAULT_TEMPERATURE,
    GEMINI_DEFAULT_TOP_P,
    GEMINI_DEFAULT_INPUT_TOKEN_LIMIT,
    GEMINI_DEFAULT_OUTPUT_TOKEN_LIMIT,
    GEMINI_MAX_OUTPUT_TOKENS_LIMIT
} from '../utils.js';
import { MODEL_PROTOCOL_PREFIX } from '../../common.js';
import {
    generateResponseCreated,
    generateResponseInProgress,
    generateOutputItemAdded,
    generateContentPartAdded,
    generateOutputTextDone,
    generateContentPartDone,
    generateOutputItemDone,
    generateResponseCompleted
} from '../../openai/openai-responses-core.mjs';

/**
 * Claude Converter Class
 * Implements conversion from Claude protocol to other protocols
 */
export class ClaudeConverter extends BaseConverter {
    constructor() {
        super('claude');
    }

    /**
     * Convert request
     */
    convertRequest(data, targetProtocol) {
        switch (targetProtocol) {
            case MODEL_PROTOCOL_PREFIX.OPENAI:
                return this.toOpenAIRequest(data);
            case MODEL_PROTOCOL_PREFIX.GEMINI:
                return this.toGeminiRequest(data);
            case MODEL_PROTOCOL_PREFIX.OPENAI_RESPONSES:
                return this.toOpenAIResponsesRequest(data);
            default:
                throw new Error(`Unsupported target protocol: ${targetProtocol}`);
        }
    }

    /**
     * Convert response
     */
    convertResponse(data, targetProtocol, model) {
        switch (targetProtocol) {
            case MODEL_PROTOCOL_PREFIX.OPENAI:
                return this.toOpenAIResponse(data, model);
            case MODEL_PROTOCOL_PREFIX.GEMINI:
                return this.toGeminiResponse(data, model);
            case MODEL_PROTOCOL_PREFIX.OPENAI_RESPONSES:
                return this.toOpenAIResponsesResponse(data, model);
            default:
                throw new Error(`Unsupported target protocol: ${targetProtocol}`);
        }
    }

    /**
     * Convert stream response chunk
     */
    convertStreamChunk(chunk, targetProtocol, model) {
        switch (targetProtocol) {
            case MODEL_PROTOCOL_PREFIX.OPENAI:
                return this.toOpenAIStreamChunk(chunk, model);
            case MODEL_PROTOCOL_PREFIX.GEMINI:
                return this.toGeminiStreamChunk(chunk, model);
            case MODEL_PROTOCOL_PREFIX.OPENAI_RESPONSES:
                return this.toOpenAIResponsesStreamChunk(chunk, model);
            default:
                throw new Error(`Unsupported target protocol: ${targetProtocol}`);
        }
    }

    /**
     * Convert model list
     */
    convertModelList(data, targetProtocol) {
        switch (targetProtocol) {
            case MODEL_PROTOCOL_PREFIX.OPENAI:
                return this.toOpenAIModelList(data);
            case MODEL_PROTOCOL_PREFIX.GEMINI:
                return this.toGeminiModelList(data);
            default:
                return data;
        }
    }

    // =========================================================================
    // Claude -> OpenAI Conversion
    // =========================================================================

    /**
     * Claude request -> OpenAI request
     */
    toOpenAIRequest(claudeRequest) {
        const openaiMessages = [];
        let systemMessageContent = '';

        // Add system message
        if (claudeRequest.system) {
            systemMessageContent = claudeRequest.system;
        }

        // Process messages
        if (claudeRequest.messages && Array.isArray(claudeRequest.messages)) {
            const tempOpenAIMessages = [];
            for (const msg of claudeRequest.messages) {
                const role = msg.role;

                // Process user tool result messages
                if (role === "user" && Array.isArray(msg.content)) {
                    const hasToolResult = msg.content.some(
                        item => item && typeof item === 'object' && item.type === "tool_result"
                    );

                    if (hasToolResult) {
                        for (const item of msg.content) {
                            if (item && typeof item === 'object' && item.type === "tool_result") {
                                const toolUseId = item.tool_use_id || item.id || "";
                                const contentStr = String(item.content || "");
                                tempOpenAIMessages.push({
                                    role: "tool",
                                    tool_call_id: toolUseId,
                                    content: contentStr,
                                });
                            }
                        }
                        continue;
                    }
                }

                // Process tool calls in assistant messages
                if (role === "assistant" && Array.isArray(msg.content) && msg.content.length > 0) {
                    const firstPart = msg.content[0];
                    if (firstPart.type === "tool_use") {
                        const funcName = firstPart.name || "";
                        const funcArgs = firstPart.input || {};
                        tempOpenAIMessages.push({
                            role: "assistant",
                            content: '',
                            tool_calls: [
                                {
                                    id: firstPart.id || `call_${funcName}_1`,
                                    type: "function",
                                    function: {
                                        name: funcName,
                                        arguments: JSON.stringify(funcArgs)
                                    },
                                    index: firstPart.index || 0
                                }
                            ]
                        });
                        continue;
                    }
                }

                // Regular text message
                const contentConverted = this.processClaudeContentToOpenAIContent(msg.content || "");
                if (contentConverted && (Array.isArray(contentConverted) ? contentConverted.length > 0 : contentConverted.trim().length > 0)) {
                    tempOpenAIMessages.push({
                        role: role,
                        content: contentConverted
                    });
                }
            }

            // OpenAI compatibility validation
            const validatedMessages = [];
            for (let idx = 0; idx < tempOpenAIMessages.length; idx++) {
                const m = tempOpenAIMessages[idx];
                if (m.role === "assistant" && m.tool_calls) {
                    const callIds = m.tool_calls.map(tc => tc.id).filter(id => id);
                    let unmatched = new Set(callIds);
                    for (let laterIdx = idx + 1; laterIdx < tempOpenAIMessages.length; laterIdx++) {
                        const later = tempOpenAIMessages[laterIdx];
                        if (later.role === "tool" && unmatched.has(later.tool_call_id)) {
                            unmatched.delete(later.tool_call_id);
                        }
                        if (unmatched.size === 0) break;
                    }
                    if (unmatched.size > 0) {
                        m.tool_calls = m.tool_calls.filter(tc => !unmatched.has(tc.id));
                        if (m.tool_calls.length === 0) {
                            delete m.tool_calls;
                            if (m.content === null) m.content = "";
                        }
                    }
                }
                validatedMessages.push(m);
            }
            openaiMessages.push(...validatedMessages);
        }

        const openaiRequest = {
            model: claudeRequest.model,
            messages: openaiMessages,
            max_tokens: checkAndAssignOrDefault(claudeRequest.max_tokens, OPENAI_DEFAULT_MAX_TOKENS),
            temperature: checkAndAssignOrDefault(claudeRequest.temperature, OPENAI_DEFAULT_TEMPERATURE),
            top_p: checkAndAssignOrDefault(claudeRequest.top_p, OPENAI_DEFAULT_TOP_P),
            stream: claudeRequest.stream,
        };

        // Process tools
        if (claudeRequest.tools) {
            const openaiTools = [];
            for (const tool of claudeRequest.tools) {
                openaiTools.push({
                    type: "function",
                    function: {
                        name: tool.name || "",
                        description: tool.description || "",
                        parameters: cleanJsonSchema(tool.input_schema || {})
                    }
                });
            }
            openaiRequest.tools = openaiTools;
            openaiRequest.tool_choice = "auto";
        }

        // Process thinking conversion
        if (claudeRequest.thinking && claudeRequest.thinking.type === "enabled") {
            const budgetTokens = claudeRequest.thinking.budget_tokens;
            const reasoningEffort = determineReasoningEffortFromBudget(budgetTokens);
            openaiRequest.reasoning_effort = reasoningEffort;

            let maxCompletionTokens = null;
            if (claudeRequest.max_tokens !== undefined) {
                maxCompletionTokens = claudeRequest.max_tokens;
                delete openaiRequest.max_tokens;
            } else {
                const envMaxTokens = process.env.OPENAI_REASONING_MAX_TOKENS;
                if (envMaxTokens) {
                    try {
                        maxCompletionTokens = parseInt(envMaxTokens, 10);
                    } catch (e) {
                        console.warn(`Invalid OPENAI_REASONING_MAX_TOKENS value '${envMaxTokens}'`);
                    }
                }
                if (!envMaxTokens) {
                    throw new Error("For OpenAI reasoning models, max_completion_tokens is required.");
                }
            }
            openaiRequest.max_completion_tokens = maxCompletionTokens;
        }

        // Add system message
        if (systemMessageContent) {
            let stringifiedSystemMessageContent = systemMessageContent;
            if (Array.isArray(systemMessageContent)) {
                stringifiedSystemMessageContent = systemMessageContent.map(item =>
                    typeof item === 'string' ? item : item.text).join('\n');
            }
            openaiRequest.messages.unshift({ role: 'system', content: stringifiedSystemMessageContent });
        }

        return openaiRequest;
    }

    /**
     * Claude response -> OpenAI response
     */
    toOpenAIResponse(claudeResponse, model) {
        if (!claudeResponse || !claudeResponse.content || claudeResponse.content.length === 0) {
            return {
                id: `chatcmpl-${uuidv4()}`,
                object: "chat.completion",
                created: Math.floor(Date.now() / 1000),
                model: model,
                choices: [{
                    index: 0,
                    message: {
                        role: "assistant",
                        content: "",
                    },
                    finish_reason: "stop",
                }],
                usage: {
                    prompt_tokens: claudeResponse.usage?.input_tokens || 0,
                    completion_tokens: claudeResponse.usage?.output_tokens || 0,
                    total_tokens: (claudeResponse.usage?.input_tokens || 0) + (claudeResponse.usage?.output_tokens || 0),
                },
            };
        }

        // Check if contains tool_use
        const hasToolUse = claudeResponse.content.some(block => block && block.type === 'tool_use');
        
        let message = {
            role: "assistant",
            content: null
        };

        if (hasToolUse) {
            // Process response containing tool calls
            const toolCalls = [];
            let textContent = '';

            for (const block of claudeResponse.content) {
                if (!block) continue;

                if (block.type === 'text') {
                    textContent += block.text || '';
                } else if (block.type === 'tool_use') {
                    toolCalls.push({
                        id: block.id || `call_${block.name}_${Date.now()}`,
                        type: "function",
                        function: {
                            name: block.name || '',
                            arguments: JSON.stringify(block.input || {})
                        }
                    });
                }
            }

            message.content = textContent || null;
            if (toolCalls.length > 0) {
                message.tool_calls = toolCalls;
            }
        } else {
            // Process regular text response
            message.content = this.processClaudeResponseContent(claudeResponse.content);
        }

        // Process finish_reason
        let finishReason = 'stop';
        if (claudeResponse.stop_reason === 'end_turn') {
            finishReason = 'stop';
        } else if (claudeResponse.stop_reason === 'max_tokens') {
            finishReason = 'length';
        } else if (claudeResponse.stop_reason === 'tool_use') {
            finishReason = 'tool_calls';
        } else if (claudeResponse.stop_reason) {
            finishReason = claudeResponse.stop_reason;
        }

        return {
            id: `chatcmpl-${uuidv4()}`,
            object: "chat.completion",
            created: Math.floor(Date.now() / 1000),
            model: model,
            choices: [{
                index: 0,
                message: message,
                finish_reason: finishReason,
            }],
            usage: {
                prompt_tokens: claudeResponse.usage?.input_tokens || 0,
                completion_tokens: claudeResponse.usage?.output_tokens || 0,
                total_tokens: (claudeResponse.usage?.input_tokens || 0) + (claudeResponse.usage?.output_tokens || 0),
                cached_tokens: claudeResponse.usage?.cache_read_input_tokens || 0,
                prompt_tokens_details: {
                    cached_tokens: claudeResponse.usage?.cache_read_input_tokens || 0
                }
            },
        };
    }

    /**
     * Claude stream response -> OpenAI stream response
     */
    toOpenAIStreamChunk(claudeChunk, model) {
        if (!claudeChunk) return null;

        // Process Claude stream events
        const chunkId = `chatcmpl-${uuidv4()}`;
        const timestamp = Math.floor(Date.now() / 1000);

        // message_start event
        if (claudeChunk.type === 'message_start') {
            return {
                id: chunkId,
                object: "chat.completion.chunk",
                created: timestamp,
                model: model,
                system_fingerprint: "",
                choices: [{
                    index: 0,
                    delta: {
                        role: "assistant",
                        content: ""
                    },
                    finish_reason: null
                }],
                usage: {
                    prompt_tokens: claudeChunk.message?.usage?.input_tokens || 0,
                    completion_tokens: 0,
                    total_tokens: claudeChunk.message?.usage?.input_tokens || 0,
                    cached_tokens: claudeChunk.message?.usage?.cache_read_input_tokens || 0
                }
            };
        }

        // content_block_start event
        if (claudeChunk.type === 'content_block_start') {
            const contentBlock = claudeChunk.content_block;

            // Process tool_use type
            if (contentBlock && contentBlock.type === 'tool_use') {
                return {
                    id: chunkId,
                    object: "chat.completion.chunk",
                    created: timestamp,
                    model: model,
                    system_fingerprint: "",
                    choices: [{
                        index: 0,
                        delta: {
                            tool_calls: [{
                                index: claudeChunk.index || 0,
                                id: contentBlock.id,
                                type: "function",
                                function: {
                                    name: contentBlock.name,
                                    arguments: ""
                                }
                            }]
                        },
                        finish_reason: null
                    }]
                };
            }

            // Process text type
            return {
                id: chunkId,
                object: "chat.completion.chunk",
                created: timestamp,
                model: model,
                system_fingerprint: "",
                choices: [{
                    index: 0,
                    delta: {
                        content: ""
                    },
                    finish_reason: null
                }]
            };
        }

        // content_block_delta event
        if (claudeChunk.type === 'content_block_delta') {
            const delta = claudeChunk.delta;

            // Process text_delta
            if (delta && delta.type === 'text_delta') {
                return {
                    id: chunkId,
                    object: "chat.completion.chunk",
                    created: timestamp,
                    model: model,
                    system_fingerprint: "",
                    choices: [{
                        index: 0,
                        delta: {
                            content: delta.text || ""
                        },
                        finish_reason: null
                    }]
                };
            }

            // Process thinking_delta (reasoning content)
            if (delta && delta.type === 'thinking_delta') {
                return {
                    id: chunkId,
                    object: "chat.completion.chunk",
                    created: timestamp,
                    model: model,
                    system_fingerprint: "",
                    choices: [{
                        index: 0,
                        delta: {
                            reasoning_content: delta.thinking || ""
                        },
                        finish_reason: null
                    }]
                };
            }

            // Process input_json_delta (tool arguments)
            if (delta && delta.type === 'input_json_delta') {
                return {
                    id: chunkId,
                    object: "chat.completion.chunk",
                    created: timestamp,
                    model: model,
                    system_fingerprint: "",
                    choices: [{
                        index: 0,
                        delta: {
                            tool_calls: [{
                                index: claudeChunk.index || 0,
                                function: {
                                    arguments: delta.partial_json || ""
                                }
                            }]
                        },
                        finish_reason: null
                    }]
                };
            }
        }

        // content_block_stop event
        if (claudeChunk.type === 'content_block_stop') {
            return {
                id: chunkId,
                object: "chat.completion.chunk",
                created: timestamp,
                model: model,
                system_fingerprint: "",
                choices: [{
                    index: 0,
                    delta: {},
                    finish_reason: null
                }]
            };
        }

        // message_delta event
        if (claudeChunk.type === 'message_delta') {
            const stopReason = claudeChunk.delta?.stop_reason;
            const finishReason = stopReason === 'end_turn' ? 'stop' :
                                stopReason === 'max_tokens' ? 'length' :
                                stopReason === 'tool_use' ? 'tool_calls' :
                                stopReason || 'stop';

            return {
                id: chunkId,
                object: "chat.completion.chunk",
                created: timestamp,
                model: model,
                system_fingerprint: "",
                choices: [{
                    index: 0,
                    delta: {},
                    finish_reason: finishReason
                }],
                usage: claudeChunk.usage ? {
                    prompt_tokens: claudeChunk.usage.input_tokens || 0,
                    completion_tokens: claudeChunk.usage.output_tokens || 0,
                    total_tokens: (claudeChunk.usage.input_tokens || 0) + (claudeChunk.usage.output_tokens || 0),
                    cached_tokens: claudeChunk.usage.cache_read_input_tokens || 0,
                    prompt_tokens_details: {
                        cached_tokens: claudeChunk.usage.cache_read_input_tokens || 0
                    }
                } : undefined
            };
        }

        // message_stop event
        if (claudeChunk.type === 'message_stop') {
            return {
                id: chunkId,
                object: "chat.completion.chunk",
                created: timestamp,
                model: model,
                system_fingerprint: "",
                choices: [{
                    index: 0,
                    delta: {},
                    finish_reason: 'stop'
                }]
            };
        }

        // Backward compatibility: if string, use directly as text content
        if (typeof claudeChunk === 'string') {
            return {
                id: chunkId,
                object: "chat.completion.chunk",
                created: timestamp,
                model: model,
                system_fingerprint: "",
                choices: [{
                    index: 0,
                    delta: {
                        content: claudeChunk
                    },
                    finish_reason: null
                }]
            };
        }

        return null;
    }

    /**
     * Claude model list -> OpenAI model list
     */
    toOpenAIModelList(claudeModels) {
        return {
            object: "list",
            data: claudeModels.models.map(m => ({
                id: m.id || m.name,
                object: "model",
                created: Math.floor(Date.now() / 1000),
                owned_by: "anthropic",
            })),
        };
    }

    /**
     * Convert Claude model list to Gemini model list
     */
    toGeminiModelList(claudeModels) {
        const models = claudeModels.models || [];
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

    /**
     * Process Claude content to OpenAI format
     */
    processClaudeContentToOpenAIContent(content) {
        if (!content || !Array.isArray(content)) return [];
        
        const contentArray = [];
        
        content.forEach(block => {
            if (!block) return;
            
            switch (block.type) {
                case 'text':
                    if (block.text) {
                        contentArray.push({
                            type: 'text',
                            text: block.text
                        });
                    }
                    break;
                    
                case 'image':
                    if (block.source && block.source.type === 'base64') {
                        contentArray.push({
                            type: 'image_url',
                            image_url: {
                                url: `data:${block.source.media_type};base64,${block.source.data}`
                            }
                        });
                    }
                    break;
                    
                case 'tool_use':
                    contentArray.push({
                        type: 'text',
                        text: `[Tool use: ${block.name}]`
                    });
                    break;
                    
                case 'tool_result':
                    contentArray.push({
                        type: 'text',
                        text: typeof block.content === 'string' ? block.content : JSON.stringify(block.content)
                    });
                    break;
                    
                default:
                    if (block.text) {
                        contentArray.push({
                            type: 'text',
                            text: block.text
                        });
                    }
            }
        });
        
        return contentArray;
    }

    /**
     * Process Claude response content
     */
    processClaudeResponseContent(content) {
        if (!content || !Array.isArray(content)) return '';
        
        const contentArray = [];
        
        content.forEach(block => {
            if (!block) return;
            
            switch (block.type) {
                case 'text':
                    contentArray.push({
                        type: 'text',
                        text: block.text || ''
                    });
                    break;
                    
                case 'image':
                    if (block.source && block.source.type === 'base64') {
                        contentArray.push({
                            type: 'image_url',
                            image_url: {
                                url: `data:${block.source.media_type};base64,${block.source.data}`
                            }
                        });
                    }
                    break;
                    
                default:
                    if (block.text) {
                        contentArray.push({
                            type: 'text',
                            text: block.text
                        });
                    }
            }
        });
        
        return contentArray.length === 1 && contentArray[0].type === 'text'
            ? contentArray[0].text
            : contentArray;
    }

    // =========================================================================
    // Claude -> Gemini Conversion
    // =========================================================================

    /**
     * Claude request -> Gemini request
     */
    toGeminiRequest(claudeRequest) {
        if (!claudeRequest || typeof claudeRequest !== 'object') {
            console.warn("Invalid claudeRequest provided to toGeminiRequest.");
            return { contents: [] };
        }

        const geminiRequest = {
            contents: []
        };

        // Process system instruction
        if (claudeRequest.system) {
            let incomingSystemText = null;
            if (typeof claudeRequest.system === 'string') {
                incomingSystemText = claudeRequest.system;
            } else if (typeof claudeRequest.system === 'object') {
                incomingSystemText = JSON.stringify(claudeRequest.system);
            }
            geminiRequest.systemInstruction = {
                parts: [{ text: incomingSystemText }]
            };
        }

        // Process messages
        if (Array.isArray(claudeRequest.messages)) {
            claudeRequest.messages.forEach(message => {
                if (!message || typeof message !== 'object' || !message.role || !message.content) {
                    console.warn("Skipping invalid message in claudeRequest.messages.");
                    return;
                }

                const geminiRole = message.role === 'assistant' ? 'model' : 'user';
                const processedParts = this.processClaudeContentToGeminiParts(message.content);

                const functionResponsePart = processedParts.find(part => part.functionResponse);
                if (functionResponsePart) {
                    geminiRequest.contents.push({
                        role: 'function',
                        parts: [functionResponsePart]
                    });
                } else if (processedParts.length > 0) {
                    geminiRequest.contents.push({
                        role: geminiRole,
                        parts: processedParts
                    });
                }
            });
        }

        // Add generation config
        const generationConfig = {};
        // Cap maxOutputTokens to Gemini's limit (65536)
        const requestedMaxTokens = checkAndAssignOrDefault(claudeRequest.max_tokens, GEMINI_DEFAULT_MAX_TOKENS);
        generationConfig.maxOutputTokens = Math.min(requestedMaxTokens, GEMINI_MAX_OUTPUT_TOKENS_LIMIT);
        generationConfig.temperature = checkAndAssignOrDefault(claudeRequest.temperature, GEMINI_DEFAULT_TEMPERATURE);
        generationConfig.topP = checkAndAssignOrDefault(claudeRequest.top_p, GEMINI_DEFAULT_TOP_P);
        
        if (Object.keys(generationConfig).length > 0) {
            geminiRequest.generationConfig = generationConfig;
        }

        // Process tools
        if (Array.isArray(claudeRequest.tools)) {
            geminiRequest.tools = [{
                functionDeclarations: claudeRequest.tools.map(tool => {
                    if (!tool || typeof tool !== 'object' || !tool.name) {
                        console.warn("Skipping invalid tool declaration in claudeRequest.tools.");
                        return null;
                    }

                    delete tool.input_schema.$schema;
                    return {
                        name: String(tool.name),
                        description: String(tool.description || ''),
                        parameters: tool.input_schema && typeof tool.input_schema === 'object' 
                            ? tool.input_schema 
                            : { type: 'object', properties: {} }
                    };
                }).filter(Boolean)
            }];
            
            if (geminiRequest.tools[0].functionDeclarations.length === 0) {
                delete geminiRequest.tools;
            }
        }

        // Process tool_choice
        if (claudeRequest.tool_choice) {
            geminiRequest.toolConfig = this.buildGeminiToolConfigFromClaude(claudeRequest.tool_choice);
        }

        return geminiRequest;
    }

    /**
     * Claude response -> Gemini response
     */
    toGeminiResponse(claudeResponse, model) {
        if (!claudeResponse || !claudeResponse.content || claudeResponse.content.length === 0) {
            return { candidates: [], usageMetadata: {} };
        }

        const parts = [];

        // Process content blocks
        for (const block of claudeResponse.content) {
            if (!block) continue;

            switch (block.type) {
                case 'text':
                    if (block.text) {
                        parts.push({ text: block.text });
                    }
                    break;

                case 'tool_use':
                    parts.push({
                        functionCall: {
                            name: block.name,
                            args: block.input || {}
                        }
                    });
                    break;

                case 'image':
                    if (block.source && block.source.type === 'base64') {
                        parts.push({
                            inlineData: {
                                mimeType: block.source.media_type,
                                data: block.source.data
                            }
                        });
                    }
                    break;

                default:
                    if (block.text) {
                        parts.push({ text: block.text });
                    }
            }
        }

        // Map finish_reason
        const finishReasonMap = {
            'end_turn': 'STOP',
            'max_tokens': 'MAX_TOKENS',
            'tool_use': 'STOP',
            'stop_sequence': 'STOP'
        };

        return {
            candidates: [{
                content: {
                    role: 'model',
                    parts: parts
                },
                finishReason: finishReasonMap[claudeResponse.stop_reason] || 'STOP'
            }],
            usageMetadata: claudeResponse.usage ? {
                promptTokenCount: claudeResponse.usage.input_tokens || 0,
                candidatesTokenCount: claudeResponse.usage.output_tokens || 0,
                totalTokenCount: (claudeResponse.usage.input_tokens || 0) + (claudeResponse.usage.output_tokens || 0),
                cachedContentTokenCount: claudeResponse.usage.cache_read_input_tokens || 0,
                promptTokensDetails: [{
                    modality: "TEXT",
                    tokenCount: claudeResponse.usage.input_tokens || 0
                }],
                candidatesTokensDetails: [{
                    modality: "TEXT",
                    tokenCount: claudeResponse.usage.output_tokens || 0
                }]
            } : {}
        };
    }

    /**
     * Claude stream response -> Gemini stream response
     */
    toGeminiStreamChunk(claudeChunk, model) {
        if (!claudeChunk) return null;

        // Process Claude stream events
        if (typeof claudeChunk === 'object' && !Array.isArray(claudeChunk)) {
            // content_block_delta event
            if (claudeChunk.type === 'content_block_delta') {
                const delta = claudeChunk.delta;
                
                // Process text_delta
                if (delta && delta.type === 'text_delta') {
                    return {
                        candidates: [{
                            content: {
                                role: "model",
                                parts: [{
                                    text: delta.text || ""
                                }]
                            }
                        }]
                    };
                }

                // Process thinking_delta - map to text
                if (delta && delta.type === 'thinking_delta') {
                    return {
                        candidates: [{
                            content: {
                                role: "model",
                                parts: [{
                                    text: delta.thinking || ""
                                }]
                            }
                        }]
                    };
                }
            }
            
            // message_delta event - stream end
            if (claudeChunk.type === 'message_delta') {
                const stopReason = claudeChunk.delta?.stop_reason;
                const result = {
                    candidates: [{
                        finishReason: stopReason === 'end_turn' ? 'STOP' :
                                    stopReason === 'max_tokens' ? 'MAX_TOKENS' :
                                    'OTHER'
                    }]
                };
                
                // Add usage info
                if (claudeChunk.usage) {
                    result.usageMetadata = {
                        promptTokenCount: claudeChunk.usage.input_tokens || 0,
                        candidatesTokenCount: claudeChunk.usage.output_tokens || 0,
                        totalTokenCount: (claudeChunk.usage.input_tokens || 0) + (claudeChunk.usage.output_tokens || 0),
                        cachedContentTokenCount: claudeChunk.usage.cache_read_input_tokens || 0,
                        promptTokensDetails: [{
                            modality: "TEXT",
                            tokenCount: claudeChunk.usage.input_tokens || 0
                        }],
                        candidatesTokensDetails: [{
                            modality: "TEXT",
                            tokenCount: claudeChunk.usage.output_tokens || 0
                        }]
                    };
                }
                
                return result;
            }
        }

        // Backward compatibility: handle string format
        if (typeof claudeChunk === 'string') {
            return {
                candidates: [{
                    content: {
                        role: "model",
                        parts: [{
                            text: claudeChunk
                        }]
                    }
                }]
            };
        }

        return null;
    }

    /**
     * Process Claude content to Gemini parts
     */
    processClaudeContentToGeminiParts(content) {
        if (!content) return [];

        if (typeof content === 'string') {
            return [{ text: content }];
        }

        if (Array.isArray(content)) {
            const parts = [];

            content.forEach(block => {
                if (!block || typeof block !== 'object' || !block.type) {
                    console.warn("Skipping invalid content block.");
                    return;
                }

                switch (block.type) {
                    case 'text':
                        if (typeof block.text === 'string') {
                            parts.push({ text: block.text });
                        }
                        break;

                    case 'image':
                        if (block.source && typeof block.source === 'object' && 
                            block.source.type === 'base64' &&
                            typeof block.source.media_type === 'string' && 
                            typeof block.source.data === 'string') {
                            parts.push({
                                inlineData: {
                                    mimeType: block.source.media_type,
                                    data: block.source.data
                                }
                            });
                        }
                        break;

                    case 'tool_use':
                        if (typeof block.name === 'string' && 
                            block.input && typeof block.input === 'object') {
                            parts.push({
                                functionCall: {
                                    name: block.name,
                                    args: block.input
                                }
                            });
                        }
                        break;

                    case 'tool_result':
                        if (typeof block.tool_use_id === 'string') {
                            parts.push({
                                functionResponse: {
                                    name: block.tool_use_id,
                                    response: { content: block.content }
                                }
                            });
                        }
                        break;

                    default:
                        if (typeof block.text === 'string') {
                            parts.push({ text: block.text });
                        }
                }
            });

            return parts;
        }

        return [];
    }

    /**
     * Build Gemini tool config
     */
    buildGeminiToolConfigFromClaude(claudeToolChoice) {
        if (!claudeToolChoice || typeof claudeToolChoice !== 'object' || !claudeToolChoice.type) {
            console.warn("Invalid claudeToolChoice provided.");
            return undefined;
        }

        switch (claudeToolChoice.type) {
            case 'auto':
                return { functionCallingConfig: { mode: 'AUTO' } };
            case 'none':
                return { functionCallingConfig: { mode: 'NONE' } };
            case 'tool':
                if (claudeToolChoice.name && typeof claudeToolChoice.name === 'string') {
                    return { 
                        functionCallingConfig: { 
                            mode: 'ANY', 
                            allowedFunctionNames: [claudeToolChoice.name] 
                        } 
                    };
                }
                console.warn("Invalid tool name in claudeToolChoice of type 'tool'.");
                return undefined;
            default:
                console.warn(`Unsupported claudeToolChoice type: ${claudeToolChoice.type}`);
                return undefined;
        }
    }

    // =========================================================================
    // Claude -> OpenAI Responses Conversion
    // =========================================================================

    /**
     * Claude request -> OpenAI Responses request
     */
    toOpenAIResponsesRequest(claudeRequest) {
        // Convert to OpenAI Responses format
        const responsesRequest = {
            model: claudeRequest.model,
            max_tokens: checkAndAssignOrDefault(claudeRequest.max_tokens, OPENAI_DEFAULT_MAX_TOKENS),
            temperature: checkAndAssignOrDefault(claudeRequest.temperature, OPENAI_DEFAULT_TEMPERATURE),
            top_p: checkAndAssignOrDefault(claudeRequest.top_p, OPENAI_DEFAULT_TOP_P),
        };

        // Process system instruction
        if (claudeRequest.system) {
            responsesRequest.instructions = claudeRequest.system;
        }

        // Process messages
        if (claudeRequest.messages && Array.isArray(claudeRequest.messages)) {
            responsesRequest.input = claudeRequest.messages;
        }

        return responsesRequest;
    }

    /**
     * Claude response -> OpenAI Responses response
     */
    toOpenAIResponsesResponse(claudeResponse, model) {
        const content = this.processClaudeResponseContent(claudeResponse.content);
        const textContent = typeof content === 'string' ? content : JSON.stringify(content);

        let output = [];
        output.push({
            type: "message",
            id: `msg_${uuidv4().replace(/-/g, '')}`,
            summary: [],
            role: "assistant",
            status: "completed",
            content: [{
                annotations: [],
                logprobs: [],
                text: textContent,
                type: "output_text"
            }]
        });

        return {
            background: false,
            created_at: Math.floor(Date.now() / 1000),
            error: null,
            id: `resp_${uuidv4().replace(/-/g, '')}`,
            incomplete_details: null,
            max_output_tokens: null,
            max_tool_calls: null,
            metadata: {},
            model: model || claudeResponse.model,
            object: "response",
            output: output,
            parallel_tool_calls: true,
            previous_response_id: null,
            prompt_cache_key: null,
            reasoning: {},
            safety_identifier: "user-" + uuidv4().replace(/-/g, ''),
            service_tier: "default",
            status: "completed",
            store: false,
            temperature: 1,
            text: {
                format: { type: "text" },
            },
            tool_choice: "auto",
            tools: [],
            top_logprobs: 0,
            top_p: 1,
            truncation: "disabled",
            usage: {
                input_tokens: claudeResponse.usage?.input_tokens || 0,
                input_tokens_details: {
                    cached_tokens: claudeResponse.usage?.cache_read_input_tokens || 0
                },
                output_tokens: claudeResponse.usage?.output_tokens || 0,
                output_tokens_details: {
                    reasoning_tokens: 0
                },
                total_tokens: (claudeResponse.usage?.input_tokens || 0) + (claudeResponse.usage?.output_tokens || 0)
            },
            user: null
        };
    }

    /**
     * Claude stream response -> OpenAI Responses stream response
     */
    toOpenAIResponsesStreamChunk(claudeChunk, model, requestId = null) {
        if (!claudeChunk) return [];

        const responseId = requestId || `resp_${uuidv4().replace(/-/g, '')}`;
        const events = [];

        // message_start event - stream start
        if (claudeChunk.type === 'message_start') {
            events.push(
                generateResponseCreated(responseId, model || 'unknown'),
                generateResponseInProgress(responseId),
                generateOutputItemAdded(responseId),
                generateContentPartAdded(responseId)
            );
        }

        // content_block_start event
        if (claudeChunk.type === 'content_block_start') {
            const contentBlock = claudeChunk.content_block;

            // For tool_use type, add tool call item
            if (contentBlock && contentBlock.type === 'tool_use') {
                events.push({
                    item: {
                        id: contentBlock.id,
                        type: "function_call",
                        name: contentBlock.name,
                        arguments: "",
                        status: "in_progress"
                    },
                    output_index: claudeChunk.index || 0,
                    sequence_number: 2,
                    type: "response.output_item.added"
                });
            }
        }

        // content_block_delta event
        if (claudeChunk.type === 'content_block_delta') {
            const delta = claudeChunk.delta;

            // Process text delta
            if (delta && delta.type === 'text_delta') {
                events.push({
                    delta: delta.text || "",
                    item_id: `msg_${uuidv4().replace(/-/g, '')}`,
                    output_index: claudeChunk.index || 0,
                    sequence_number: 3,
                    type: "response.output_text.delta"
                });
            }
            // Process reasoning content delta
            else if (delta && delta.type === 'thinking_delta') {
                events.push({
                    delta: delta.thinking || "",
                    item_id: `thinking_${uuidv4().replace(/-/g, '')}`,
                    output_index: claudeChunk.index || 0,
                    sequence_number: 3,
                    type: "response.reasoning_summary_text.delta"
                });
            }
            // Process tool call arguments delta
            else if (delta && delta.type === 'input_json_delta') {
                events.push({
                    delta: delta.partial_json || "",
                    item_id: `call_${uuidv4().replace(/-/g, '')}`,
                    output_index: claudeChunk.index || 0,
                    sequence_number: 3,
                    type: "response.custom_tool_call_input.delta"
                });
            }
        }

        // content_block_stop event
        if (claudeChunk.type === 'content_block_stop') {
            events.push({
                item_id: `msg_${uuidv4().replace(/-/g, '')}`,
                output_index: claudeChunk.index || 0,
                sequence_number: 4,
                type: "response.output_item.done"
            });
        }

        // message_delta event - stream end
        if (claudeChunk.type === 'message_delta') {
            // events.push(
            //     generateOutputTextDone(responseId),
            //     generateContentPartDone(responseId),
            //     generateOutputItemDone(responseId),
            //     generateResponseCompleted(responseId)
            // );

            // If there's usage info, update the last event
            if (claudeChunk.usage && events.length > 0) {
                const lastEvent = events[events.length - 1];
                if (lastEvent.response) {
                    lastEvent.response.usage = {
                        input_tokens: claudeChunk.usage.input_tokens || 0,
                        input_tokens_details: {
                            cached_tokens: claudeChunk.usage.cache_read_input_tokens || 0
                        },
                        output_tokens: claudeChunk.usage.output_tokens || 0,
                        output_tokens_details: {
                            reasoning_tokens: 0
                        },
                        total_tokens: (claudeChunk.usage.input_tokens || 0) + (claudeChunk.usage.output_tokens || 0)
                    };
                }
            }
        }

        // message_stop event
        if (claudeChunk.type === 'message_stop') {
            events.push(
                generateOutputTextDone(responseId),
                generateContentPartDone(responseId),
                generateOutputItemDone(responseId),
                generateResponseCompleted(responseId)
            );
        }

        return events;
    }
}

export default ClaudeConverter;