import { v4 as uuidv4 } from 'uuid';
import { MODEL_PROTOCOL_PREFIX, getProtocolPrefix } from './common.js';
import {
  streamStateManager,
  generateResponseCreated,
  generateResponseInProgress,
  generateOutputItemAdded,
  generateContentPartAdded,
  generateOutputTextDelta,
  generateOutputTextDone,
  generateContentPartDone,
  generateOutputItemDone,
  generateResponseCompleted
} from './openai/openai-responses-core.mjs';

// =============================================================================
// Constants and Helper Functions
// =============================================================================

// Define default constants
const DEFAULT_MAX_TOKENS = 8192;
const DEFAULT_GEMINI_MAX_TOKENS = 65535;
const DEFAULT_TEMPERATURE = 1;
const DEFAULT_TOP_P = 0.95;

// Helper function: check if value is undefined or 0, and return default value
function checkAndAssignOrDefault(value, defaultValue) {
    if (value !== undefined && value !== 0) {
        return value;
    }
    return defaultValue;
}

/**
 * Maps finish reason
 * @param {string} reason - Finish reason
 * @param {string} sourceFormat - Source format
 * @param {string} targetFormat - Target format
 * @returns {string} Mapped finish reason
 */
function _mapFinishReason(reason, sourceFormat, targetFormat) {
    const reasonMappings = {
        openai: {
            anthropic: {
                stop: "end_turn",
                length: "max_tokens",
                content_filter: "stop_sequence",
                tool_calls: "tool_use"
            }
        },
        gemini: {
            anthropic: {
                // Old version uppercase format
                STOP: "end_turn",
                MAX_TOKENS: "max_tokens",
                SAFETY: "stop_sequence",
                RECITATION: "stop_sequence",
                // New version lowercase format (v1beta/v1 API)
                stop: "end_turn",
                length: "max_tokens",
                safety: "stop_sequence",
                recitation: "stop_sequence",
                other: "end_turn"
            }
        }
    };

    try {
        return reasonMappings[sourceFormat][targetFormat][reason] || "end_turn";
    } catch (e) {
        return "end_turn";
    }
}

/**
 * Recursively cleans JSON Schema properties not supported by Gemini
 * @param {Object} schema - JSON Schema
 * @returns {Object} Cleaned JSON Schema
 */
function _cleanJsonSchemaProperties(schema) {
    if (!schema || typeof schema !== 'object') {
        return schema;
    }

    // Remove all non-standard properties
    const sanitized = {};
    for (const [key, value] of Object.entries(schema)) {
        if (["type", "description", "properties", "required", "enum", "items"].includes(key)) {
            sanitized[key] = value;
        }
    }

    if (sanitized.properties && typeof sanitized.properties === 'object') {
        const cleanProperties = {};
        for (const [propName, propSchema] of Object.entries(sanitized.properties)) {
            cleanProperties[propName] = _cleanJsonSchemaProperties(propSchema);
        }
        sanitized.properties = cleanProperties;
    }

    if (sanitized.items) {
        sanitized.items = _cleanJsonSchemaProperties(sanitized.items);
    }

    return sanitized;
}

/**
 * Intelligently determines OpenAI reasoning_effort level based on budget_tokens
 * @param {number|null} budgetTokens - Anthropic thinking budget_tokens value
 * @returns {string} OpenAI reasoning_effort level ("low", "medium", "high")
 */
function _determineReasoningEffortFromBudget(budgetTokens) {
    // If no budget_tokens provided, default to high
    if (budgetTokens === null || budgetTokens === undefined) {
        console.info("No budget_tokens provided, defaulting to reasoning_effort='high'");
        return "high";
    }

    // Use fixed thresholds instead of environment variables
    const LOW_THRESHOLD = 50;    // Threshold for low reasoning effort
    const HIGH_THRESHOLD = 200;  // Threshold for high reasoning effort

    console.debug(`Threshold configuration: low <= ${LOW_THRESHOLD}, medium <= ${HIGH_THRESHOLD}, high > ${HIGH_THRESHOLD}`);

    let effort;
    if (budgetTokens <= LOW_THRESHOLD) {
        effort = "low";
    } else if (budgetTokens <= HIGH_THRESHOLD) {
        effort = "medium";
    } else {
        effort = "high";
    }

    console.info(`🎯 Budget tokens ${budgetTokens} -> reasoning_effort '${effort}' (thresholds: low<=${LOW_THRESHOLD}, high<=${HIGH_THRESHOLD})`);
    return effort;
}

// Global tool state manager
class ToolStateManager {
    constructor() {
        if (ToolStateManager.instance) {
            return ToolStateManager.instance;
        }
        ToolStateManager.instance = this;
        this._toolMappings = {};
        return this;
    }

    // Store tool name to ID mapping
    storeToolMapping(funcName, toolId) {
        this._toolMappings[funcName] = toolId;
    }

    // Get ID by tool name
    getToolId(funcName) {
        return this._toolMappings[funcName] || null;
    }

    // Clear all mappings
    clearMappings() {
        this._toolMappings = {};
    }
}

// Global tool state manager instance
const toolStateManager = new ToolStateManager();

// =============================================================================
// Main Conversion Functions
// =============================================================================

/**
 * Generic data conversion function.
 * @param {object} data - The data to convert (request body or response).
 * @param {string} type - The type of conversion: 'request', 'response', 'streamChunk', 'modelList'.
 * @param {string} fromProvider - The source model provider (e.g., MODEL_PROVIDER.GEMINI_CLI).
 * @param {string} toProvider - The target model provider (e.g., MODEL_PROVIDER.OPENAI_CUSTOM).
 * @param {string} [model] - Optional model name for response conversions.
 * @returns {object} The converted data.
 * @throws {Error} If no suitable conversion function is found.
 */
export function convertData(data, type, fromProvider, toProvider, model) {
    // Define a map of conversion functions using protocol prefixes
    const conversionMap = {
        request: {
            [MODEL_PROTOCOL_PREFIX.OPENAI]: { // to OpenAI protocol
                [MODEL_PROTOCOL_PREFIX.GEMINI]: toOpenAIRequestFromGemini, // from Gemini protocol
                [MODEL_PROTOCOL_PREFIX.CLAUDE]: toOpenAIRequestFromClaude, // from Claude protocol
            },
            [MODEL_PROTOCOL_PREFIX.CLAUDE]: { // to Claude protocol
                [MODEL_PROTOCOL_PREFIX.OPENAI]: toClaudeRequestFromOpenAI, // from OpenAI protocol
                [MODEL_PROTOCOL_PREFIX.OPENAI_RESPONSES]: toClaudeRequestFromOpenAIResponses, // from OpenAI protocol (Responses format)
            },
            [MODEL_PROTOCOL_PREFIX.GEMINI]: { // to Gemini protocol
                [MODEL_PROTOCOL_PREFIX.OPENAI]: toGeminiRequestFromOpenAI, // from OpenAI protocol
                [MODEL_PROTOCOL_PREFIX.CLAUDE]: toGeminiRequestFromClaude, // from Claude protocol
                [MODEL_PROTOCOL_PREFIX.OPENAI_RESPONSES]: toGeminiRequestFromOpenAIResponses, // from OpenAI protocol (Responses format)
            },
        },
        response: {
            [MODEL_PROTOCOL_PREFIX.OPENAI]: { // to OpenAI protocol
                [MODEL_PROTOCOL_PREFIX.GEMINI]: toOpenAIChatCompletionFromGemini, // from Gemini protocol
                [MODEL_PROTOCOL_PREFIX.CLAUDE]: toOpenAIChatCompletionFromClaude, // from Claude protocol
            },
            [MODEL_PROTOCOL_PREFIX.CLAUDE]: { // to Claude protocol
                [MODEL_PROTOCOL_PREFIX.GEMINI]: toClaudeChatCompletionFromGemini, // from Gemini protocol
                [MODEL_PROTOCOL_PREFIX.OPENAI]: toClaudeChatCompletionFromOpenAI, // from OpenAI protocol
            },
            [MODEL_PROTOCOL_PREFIX.OPENAI_RESPONSES]: { // to OpenAI protocol (Responses format)
                [MODEL_PROTOCOL_PREFIX.GEMINI]: toOpenAIResponsesFromGemini, // from Gemini protocol
                [MODEL_PROTOCOL_PREFIX.CLAUDE]: toOpenAIResponsesFromClaude, // from Claude protocol
            },
        },
        streamChunk: {
            [MODEL_PROTOCOL_PREFIX.OPENAI]: { // to OpenAI protocol
                [MODEL_PROTOCOL_PREFIX.GEMINI]: toOpenAIStreamChunkFromGemini, // from Gemini protocol
                [MODEL_PROTOCOL_PREFIX.CLAUDE]: toOpenAIStreamChunkFromClaude, // from Claude protocol
            },
            [MODEL_PROTOCOL_PREFIX.CLAUDE]: { // to Claude protocol
                [MODEL_PROTOCOL_PREFIX.GEMINI]: toClaudeStreamChunkFromGemini, // from Gemini protocol
                [MODEL_PROTOCOL_PREFIX.OPENAI]: toClaudeStreamChunkFromOpenAI, // from OpenAI protocol
            },
            [MODEL_PROTOCOL_PREFIX.OPENAI_RESPONSES]: { // to OpenAI protocol (Responses format)
                [MODEL_PROTOCOL_PREFIX.GEMINI]: toOpenAIResponsesStreamChunkFromGemini, // from Gemini protocol
                [MODEL_PROTOCOL_PREFIX.CLAUDE]: toOpenAIResponsesStreamChunkFromClaude, // from Claude protocol
            },
        },
        modelList: {
            [MODEL_PROTOCOL_PREFIX.OPENAI]: { // to OpenAI protocol
                [MODEL_PROTOCOL_PREFIX.GEMINI]: toOpenAIModelListFromGemini, // from Gemini protocol
                [MODEL_PROTOCOL_PREFIX.CLAUDE]: toOpenAIModelListFromClaude, // from Claude protocol
            },
            [MODEL_PROTOCOL_PREFIX.CLAUDE]: { // to Claude protocol
                [MODEL_PROTOCOL_PREFIX.GEMINI]: toClaudeModelListFromGemini, // from Gemini protocol
                [MODEL_PROTOCOL_PREFIX.OPENAI]: toClaudeModelListFromOpenAI, // from OpenAI protocol
            },
        }
    };

    const targetConversions = conversionMap[type];
    if (!targetConversions) {
        throw new Error(`Unsupported conversion type: ${type}`);
    }

    const toConversions = targetConversions[getProtocolPrefix(toProvider)];
    if (!toConversions) {
        throw new Error(`No conversions defined for target protocol: ${getProtocolPrefix(toProvider)} for type: ${type}`);
    }

    const conversionFunction = toConversions[getProtocolPrefix(fromProvider)];
    if (!conversionFunction) {
        throw new Error(`No conversion function found from ${getProtocolPrefix(fromProvider)} to ${toProvider} for type: ${type}`);
    }

    console.log(conversionFunction);
    if (type === 'response' || type === 'streamChunk' || type === 'modelList') {
        return conversionFunction(data, model);
    } else {
        return conversionFunction(data);
    }
}

// =============================================================================
// OpenAI Related Conversion Functions
// =============================================================================

/**
 * Converts a Gemini API request body to an OpenAI chat completion request body.
 * Handles system instructions and role mapping with multimodal support.
 * @param {Object} geminiRequest - The request body from the Gemini API.
 * @returns {Object} The formatted request body for the OpenAI API.
 */
export function toOpenAIRequestFromGemini(geminiRequest) {
    const openaiRequest = {
        messages: [],
        model: geminiRequest.model, // Default model if not specified in Gemini request
        max_tokens: checkAndAssignOrDefault(geminiRequest.max_tokens, DEFAULT_MAX_TOKENS),
        temperature: checkAndAssignOrDefault(geminiRequest.temperature, DEFAULT_TEMPERATURE),
        top_p: checkAndAssignOrDefault(geminiRequest.top_p, DEFAULT_TOP_P),
    };

    // Process system instruction
    if (geminiRequest.systemInstruction && Array.isArray(geminiRequest.systemInstruction.parts)) {
        const systemContent = processGeminiPartsToOpenAIContent(geminiRequest.systemInstruction.parts);
        if (systemContent) {
            openaiRequest.messages.push({
                role: 'system',
                content: systemContent
            });
        }
    }

    // Process contents
    if (geminiRequest.contents && Array.isArray(geminiRequest.contents)) {
        geminiRequest.contents.forEach(content => {
            if (content && Array.isArray(content.parts)) {
                const openaiContent = processGeminiPartsToOpenAIContent(content.parts);
                if (openaiContent && openaiContent.length > 0) {
                    const openaiRole = content.role === 'model' ? 'assistant' : content.role;
                    openaiRequest.messages.push({
                        role: openaiRole,
                        content: openaiContent
                    });
                }
            }
        });
    }

    return openaiRequest;
}


/**
 * Processes Gemini parts to OpenAI content format with multimodal support.
 * @param {Array} parts - Array of Gemini parts.
 * @returns {Array|string} OpenAI content format.
 */
function processGeminiPartsToOpenAIContent(parts) {
    if (!parts || !Array.isArray(parts)) return '';
    
    const contentArray = [];
    
    parts.forEach(part => {
        if (!part) return;
        
        // Handle text content
        if (typeof part.text === 'string') {
            contentArray.push({
                type: 'text',
                text: part.text
            });
        }
        
        // Handle inline data (images, audio)
        if (part.inlineData) {
            const { mimeType, data } = part.inlineData;
            if (mimeType && data) {
                contentArray.push({
                    type: 'image_url',
                    image_url: {
                        url: `data:${mimeType};base64,${data}`
                    }
                });
            }
        }
        
        // Handle file data
        if (part.fileData) {
            const { mimeType, fileUri } = part.fileData;
            if (mimeType && fileUri) {
                // For file URIs, we need to determine if it's an image or audio
                if (mimeType.startsWith('image/')) {
                    contentArray.push({
                        type: 'image_url',
                        image_url: {
                            url: fileUri
                        }
                    });
                } else if (mimeType.startsWith('audio/')) {
                    // For audio, we'll use a placeholder or handle as text description
                    contentArray.push({
                        type: 'text',
                        text: `[Audio file: ${fileUri}]`
                    });
                }
            }
        }
    });
    
    // Return as array for multimodal, or string for simple text
    return contentArray.length === 1 && contentArray[0].type === 'text'
        ? contentArray[0].text
        : contentArray;
}

export function toOpenAIModelListFromGemini(geminiModels) {
    return {
        object: "list",
        data: geminiModels.models.map(m => ({
            id: m.name.startsWith('models/') ? m.name.substring(7) : m.name, // Remove 'models/' prefix as id
            object: "model",
            created: Math.floor(Date.now() / 1000),
            owned_by: "google",
        })),
    };
}

export function toOpenAIChatCompletionFromGemini(geminiResponse, model) {
    const content = processGeminiResponseContent(geminiResponse);
    
    return {
        id: `chatcmpl-${uuidv4()}`,
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: model,
        choices: [{
            index: 0,
            message: {
                role: "assistant",
                content: content
            },
            finish_reason: "stop",
        }],
        usage: geminiResponse.usageMetadata ? {
            prompt_tokens: geminiResponse.usageMetadata.promptTokenCount || 0,
            completion_tokens: geminiResponse.usageMetadata.candidatesTokenCount || 0,
            total_tokens: geminiResponse.usageMetadata.totalTokenCount || 0,
        } : {
            prompt_tokens: 0,
            completion_tokens: 0,
            total_tokens: 0,
        },
    };
}

/**
 * Processes Gemini response content to OpenAI format with multimodal support.
 * @param {Object} geminiResponse - The Gemini API response.
 * @returns {string|Array} Processed content.
 */
function processGeminiResponseContent(geminiResponse) {
    if (!geminiResponse || !geminiResponse.candidates) return '';
    
    const contents = [];
    
    geminiResponse.candidates.forEach(candidate => {
        if (candidate.content && candidate.content.parts) {
            candidate.content.parts.forEach(part => {
                if (part.text) {
                    contents.push(part.text);
                }
                // Note: Gemini response typically doesn't include multimodal content in responses
                // but we handle it for completeness
            });
        }
    });
    
    return contents.join('\n');
}

export function toOpenAIStreamChunkFromGemini(geminiChunk, model) {
    return {
        id: `chatcmpl-${uuidv4()}`, // uuidv4 needs to be imported or handled
        object: "chat.completion.chunk",
        created: Math.floor(Date.now() / 1000),
        model: model,
        choices: [{
            index: 0,
            delta: { content: geminiChunk },
            finish_reason: null,
        }],
        usage: geminiChunk.usageMetadata ? {
            prompt_tokens: geminiChunk.usageMetadata.promptTokenCount || 0,
            completion_tokens: geminiChunk.usageMetadata.candidatesTokenCount || 0,
            total_tokens: geminiChunk.usageMetadata.totalTokenCount || 0,
        } : {
            prompt_tokens: 0,
            completion_tokens: 0,
            total_tokens: 0,
        },
    };
}

/**
 * Converts a Claude API messages response to an OpenAI chat completion response.
 * @param {Object} claudeResponse - The Claude API messages response object.
 * @param {string} model - The model name to include in the response.
 * @returns {Object} The formatted OpenAI chat completion response.
 */
export function toOpenAIChatCompletionFromClaude(claudeResponse, model) {
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

    const content = processClaudeResponseContent(claudeResponse.content);
    const finishReason = claudeResponse.stop_reason === 'end_turn' ? 'stop' : claudeResponse.stop_reason;

    return {
        id: `chatcmpl-${uuidv4()}`,
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: model,
        choices: [{
            index: 0,
            message: {
                role: "assistant",
                content: content
            },
            finish_reason: finishReason,
        }],
        usage: {
            prompt_tokens: claudeResponse.usage?.input_tokens || 0,
            completion_tokens: claudeResponse.usage?.output_tokens || 0,
            total_tokens: (claudeResponse.usage?.input_tokens || 0) + (claudeResponse.usage?.output_tokens || 0),
        },
    };
}

/**
 * Processes Claude response content to OpenAI format with multimodal support.
 * @param {Array} content - Array of Claude content blocks.
 * @returns {string|Array} Processed content.
 */
function processClaudeResponseContent(content) {
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
                // Handle image blocks from Claude
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
                // Handle other content types as text
                if (block.text) {
                    contentArray.push({
                        type: 'text',
                        text: block.text
                    });
                }
        }
    });
    
    // Return as array for multimodal, or string for simple text
    return contentArray.length === 1 && contentArray[0].type === 'text'
        ? contentArray[0].text
        : contentArray;
}

/**
 * Converts a Claude API messages stream chunk to an OpenAI chat completion stream chunk.
 * Based on the official Claude Messages API stream events.
 * @param {Object} claudeChunk - The Claude API messages stream chunk object.
 * @param {string} [model] - Optional model name to include in the response.
 * @returns {Object} The formatted OpenAI chat completion stream chunk, or an empty object for events that don't map.
 */
export function toOpenAIStreamChunkFromClaude(claudeChunk, model) {
    if (!claudeChunk) {
        return null;
    }
    return {
        id: `chatcmpl-${uuidv4()}`, // uuidv4 needs to be imported or handled
        object: "chat.completion.chunk",
        created: Math.floor(Date.now() / 1000),
        model: model,
        system_fingerprint: "",
        choices: [{
            index: 0,
            delta: { 
                content: claudeChunk,
                reasoning_content: ""
            },
            finish_reason: !claudeChunk ? 'stop' : null,
            message: {
                content: claudeChunk,
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
 * Converts a Claude API model list response to an OpenAI model list response.
 * @param {Array<Object>} claudeModels - The array of model objects from Claude API.
 * @returns {Object} The formatted OpenAI model list response.
 */
export function toOpenAIModelListFromClaude(claudeModels) {
    return {
        object: "list",
        data: claudeModels.models.map(m => ({
            id: m.id || m.name, // Claude models might use 'name' instead of 'id'
            object: "model",
            created: Math.floor(Date.now() / 1000), // Claude may not provide 'created' timestamp
            owned_by: "anthropic",
            // You can add more properties here if they exist in Claude's model response
            // and you want to map them to OpenAI's format, e.g., permissions.
        })),
    };
}

/**
 * Converts an OpenAI chat completion response to a Claude API messages response.
 * @param {Object} openaiResponse - The OpenAI API chat completion response object.
 * @param {string} model - The model name to include in the response.
 * @returns {Object} The formatted Claude API messages response.
 */
export function toClaudeChatCompletionFromOpenAI(openaiResponse, model) {
    if (!openaiResponse || !openaiResponse.choices || openaiResponse.choices.length === 0) {
        return {
            id: `msg_${uuidv4()}`,
            type: "message",
            role: "assistant",
            content: [],
            model: model,
            stop_reason: "end_turn",
            stop_sequence: null,
            usage: {
                input_tokens: openaiResponse?.usage?.prompt_tokens || 0,
                output_tokens: openaiResponse?.usage?.completion_tokens || 0
            }
        };
    }

    const choice = openaiResponse.choices[0];
    const contentList = [];

    // Handle tool calls
    const toolCalls = choice.message?.tool_calls || [];
    for (const toolCall of toolCalls.filter(tc => tc && typeof tc === 'object')) {
        if (toolCall.function) {
            const func = toolCall.function;
            const argStr = func.arguments || "{}";
            let argObj;
            try {
                argObj = typeof argStr === 'string' ? JSON.parse(argStr) : argStr;
            } catch (e) {
                argObj = {};
            }
            contentList.push({
                type: "tool_use",
                id: toolCall.id || "",
                name: func.name || "",
                input: argObj,
            });
        }
    }

    // Handle text content
    const contentText = choice.message?.content || "";
    if (contentText) {
        // Use _extractThinkingFromOpenAIText to extract thinking content
        const extractedContent = _extractThinkingFromOpenAIText(contentText);
        if (Array.isArray(extractedContent)) {
            contentList.push(...extractedContent);
        } else {
            contentList.push({ type: "text", text: extractedContent });
        }
    }

    // Map OpenAI finish reason to Claude stop reason
    const stopReason = _mapFinishReason(
        choice.finish_reason || "stop",
        "openai",
        "anthropic"
    );

    return {
        id: `msg_${uuidv4()}`,
        type: "message",
        role: "assistant",
        content: contentList,
        model: model,
        stop_reason: stopReason,
        stop_sequence: null,
        usage: {
            input_tokens: openaiResponse.usage?.prompt_tokens || 0,
            output_tokens: openaiResponse.usage?.completion_tokens || 0
        }
    };
}

/**
 * Converts a Claude API request body to an OpenAI chat completion request body.
 * Handles system instructions and multimodal content.
 * @param {Object} claudeRequest - The request body from the Claude API.
 * @returns {Object} The formatted request body for the OpenAI API.
 */
export function toOpenAIRequestFromClaude(claudeRequest) {
    const openaiMessages = [];
    let systemMessageContent = '';

    // Add system message if present
    if (claudeRequest.system) {
        systemMessageContent = claudeRequest.system;
    }

    // Process messages
    if (claudeRequest.messages && Array.isArray(claudeRequest.messages)) {
        const tempOpenAIMessages = [];
        for (const msg of claudeRequest.messages) {
            const role = msg.role;

            // Handle user's tool result messages
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
                    continue; // Tool result processed, skip further processing
                }
            }

            // Handle tool calls in assistant messages
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
                    continue; // Already processed
                }
            }

            // Plain text message
            const contentConverted = processClaudeContentToOpenAIContent(msg.content || "");
            // Skip empty messages to avoid inserting empty strings in history causing model misjudgment
            if (contentConverted && (Array.isArray(contentConverted) ? contentConverted.length > 0 : contentConverted.trim().length > 0)) {
                tempOpenAIMessages.push({
                    role: role,
                    content: contentConverted
                });
            }
        }

        // ---------------- OpenAI Compatibility Check ----------------
        // Ensure all assistant.tool_calls have subsequent tool response messages; otherwise remove unmatched tool_calls
        const validatedMessages = [];
        for (let idx = 0; idx < tempOpenAIMessages.length; idx++) {
            const m = tempOpenAIMessages[idx];
            if (m.role === "assistant" && m.tool_calls) {
                const callIds = m.tool_calls.map(tc => tc.id).filter(id => id);
                // Check if there are corresponding tool messages afterwards
                let unmatched = new Set(callIds);
                for (let laterIdx = idx + 1; laterIdx < tempOpenAIMessages.length; laterIdx++) {
                    const later = tempOpenAIMessages[laterIdx];
                    if (later.role === "tool" && unmatched.has(later.tool_call_id)) {
                        unmatched.delete(later.tool_call_id);
                    }
                    if (unmatched.size === 0) {
                        break;
                    }
                }
                if (unmatched.size > 0) {
                    // Remove unmatched tool_calls
                    m.tool_calls = m.tool_calls.filter(tc => !unmatched.has(tc.id));
                    // If all are removed, downgrade to plain assistant text message
                    if (m.tool_calls.length === 0) {
                        delete m.tool_calls;
                        if (m.content === null) {
                            m.content = "";
                        }
                    }
                }
            }
            validatedMessages.push(m);
        }
        openaiMessages.push(...validatedMessages);
    }

    const openaiRequest = {
        model: claudeRequest.model, // Default OpenAI model
        messages: openaiMessages,
        max_tokens: checkAndAssignOrDefault(claudeRequest.max_tokens, DEFAULT_MAX_TOKENS),
        temperature: checkAndAssignOrDefault(claudeRequest.temperature, DEFAULT_TEMPERATURE),
        top_p: checkAndAssignOrDefault(claudeRequest.top_p, DEFAULT_TOP_P),
        stream: claudeRequest.stream, // Stream mode is handled by different endpoint
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
                    parameters: _cleanJsonSchemaProperties(tool.input_schema || {}) // Use cleaning function
                }
            });
        }
        openaiRequest.tools = openaiTools;
        openaiRequest.tool_choice = "auto";
    }

    // Handle thinking budget conversion (Anthropic thinking -> OpenAI reasoning_effort + max_completion_tokens)
    if (claudeRequest.thinking && claudeRequest.thinking.type === "enabled") {
        const budgetTokens = claudeRequest.thinking.budget_tokens;
        // Intelligently determine reasoning_effort level based on budget_tokens
        const reasoningEffort = _determineReasoningEffortFromBudget(budgetTokens);
        openaiRequest.reasoning_effort = reasoningEffort;

        // Handle max_completion_tokens priority logic
        let maxCompletionTokens = null;

        // Priority 1: max_tokens passed by client
        if (claudeRequest.max_tokens !== undefined) {
            maxCompletionTokens = claudeRequest.max_tokens;
            delete openaiRequest.max_tokens; // Remove max_tokens, use max_completion_tokens
            console.info(`Using client max_tokens as max_completion_tokens: ${maxCompletionTokens}`);
        } else {
            // Priority 2: Environment variable OPENAI_REASONING_MAX_TOKENS
            const envMaxTokens = process.env.OPENAI_REASONING_MAX_TOKENS;
            if (envMaxTokens) {
                try {
                    maxCompletionTokens = parseInt(envMaxTokens, 10);
                    console.info(`Using OPENAI_REASONING_MAX_TOKENS from environment: ${maxCompletionTokens}`);
                } catch (e) {
                    console.warn(`Invalid OPENAI_REASONING_MAX_TOKENS value '${envMaxTokens}', must be integer`);
                }
            }

            if (!envMaxTokens) {
                // Priority 3: If none, throw error
                throw new Error("For OpenAI reasoning models, max_completion_tokens is required. Please specify max_tokens in the request or set OPENAI_REASONING_MAX_TOKENS environment variable.");
            }
        }
        openaiRequest.max_completion_tokens = maxCompletionTokens;
        console.info(`Anthropic thinking enabled -> OpenAI reasoning_effort='${reasoningEffort}', max_completion_tokens=${maxCompletionTokens}`);
        if (budgetTokens) {
            console.info(`Budget tokens: ${budgetTokens} -> reasoning_effort: '${reasoningEffort}'`);
        }
    }

    // Add system message at the beginning if present
    if (systemMessageContent) {
        let stringifiedSystemMessageContent = systemMessageContent;
        if(Array.isArray(systemMessageContent)){
            stringifiedSystemMessageContent = systemMessageContent.map(item =>
                    typeof item === 'string' ? item : item.text).join('\n');
        }
        openaiRequest.messages.unshift({ role: 'system', content: stringifiedSystemMessageContent });
    }

    return openaiRequest;
}


/**
 * Processes Claude content to OpenAI content format with multimodal support.
 * @param {Array} content - Array of Claude content blocks.
 * @returns {Array} OpenAI content format.
 */
function processClaudeContentToOpenAIContent(content) {
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
                // Handle image blocks from Claude
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
                // Handle tool use as text
                contentArray.push({
                    type: 'text',
                    text: `[Tool use: ${block.name}]`
                });
                break;
                
            case 'tool_result':
                // Handle tool results as text
                contentArray.push({
                    type: 'text',
                    text: typeof block.content === 'string' ? block.content : JSON.stringify(block.content)
                });
                break;
                
            default:
                // Handle any other content types as text
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

// =============================================================================
// Gemini Related Conversion Functions
// =============================================================================

/**
 * Converts an OpenAI chat completion request body to a Gemini API request body.
 * Handles system instructions and merges consecutive messages of the same role with multimodal support.
 * @param {Object} openaiRequest - The request body from the OpenAI API.
 * @returns {Object} The formatted request body for the Gemini API.
 */
export function toGeminiRequestFromOpenAI(openaiRequest) {
    const messages = openaiRequest.messages || [];
    const { systemInstruction, nonSystemMessages } = extractAndProcessSystemMessages(messages);
    
    // Process messages with role conversion and multimodal support
    const processedMessages = [];
    let lastMessage = null;
    
    for (const message of nonSystemMessages) {
        const geminiRole = message.role === 'assistant' ? 'model' : message.role;
        
        // Handle tool responses
        if (geminiRole === 'tool') {
            if (lastMessage) processedMessages.push(lastMessage);
            processedMessages.push({
                role: 'function',
                parts: [{
                    functionResponse: {
                        name: message.name,
                        response: { content: safeParseJSON(message.content) }
                    }
                }]
            });
            lastMessage = null;
            continue;
        }
        
        // Process multimodal content
        const processedContent = processOpenAIContentToGeminiParts(message.content);
        
        // Merge consecutive text messages
        if (lastMessage && lastMessage.role === geminiRole && !message.tool_calls &&
            Array.isArray(processedContent) && processedContent.every(p => p.text) &&
            Array.isArray(lastMessage.parts) && lastMessage.parts.every(p => p.text)) {
            lastMessage.parts.push(...processedContent);
            continue;
        }
        
        if (lastMessage) processedMessages.push(lastMessage);
        lastMessage = { role: geminiRole, parts: processedContent };
    }
    if (lastMessage) processedMessages.push(lastMessage);
    
    // Build Gemini request
    const geminiRequest = {
        contents: processedMessages.filter(item => item.parts && item.parts.length > 0)
    };
    
    if (systemInstruction) geminiRequest.systemInstruction = systemInstruction;
    
    // Handle tools
    if (openaiRequest.tools?.length) {
        geminiRequest.tools = [{
            functionDeclarations: openaiRequest.tools.map(t => {
                // Ensure tool is a valid object and has function property
                if (!t || typeof t !== 'object' || !t.function) {
                    console.warn("Skipping invalid tool declaration in openaiRequest.tools.");
                    return null; // Return null for invalid tools, filter out later
                }

                const func = t.function;
                // Clean parameters schema for Gemini compatibility
                const parameters = _cleanJsonSchemaProperties(func.parameters || {});

                return {
                    name: String(func.name || ''), // Ensure name is string
                    description: String(func.description || ''), // Ensure description is string
                    parameters: parameters // Use cleaned parameters
                };
            }).filter(Boolean) // Filter out any nulls from invalid tool declarations
        }];
        // If no valid functionDeclarations, remove the tools array
        if (geminiRequest.tools[0].functionDeclarations.length === 0) {
            delete geminiRequest.tools;
        }
    }
    
    if (openaiRequest.tool_choice) {
        geminiRequest.toolConfig = buildToolConfig(openaiRequest.tool_choice);
    }
    
    // Add generation config
    const config = buildGenerationConfig(openaiRequest);
    if (Object.keys(config).length) geminiRequest.generationConfig = config;
    
    // Validation
    if (geminiRequest.contents[0]?.role !== 'user') {
        console.warn(`[Request Conversion] Warning: Conversation does not start with a 'user' role.`);
    }
    
    return geminiRequest;
}

/**
 * Processes OpenAI content to Gemini parts format with multimodal support.
 * @param {string|Array} content - OpenAI message content.
 * @returns {Array} Array of Gemini parts.
 */
function processOpenAIContentToGeminiParts(content) {
    if (!content) return [];
    
    // Handle string content
    if (typeof content === 'string') {
        return [{ text: content }];
    }
    
    // Handle array content (multimodal)
    if (Array.isArray(content)) {
        const parts = [];
        
        content.forEach(item => {
            if (!item) return;
            
            switch (item.type) {
                case 'text':
                    if (item.text) {
                        parts.push({ text: item.text });
                    }
                    break;
                    
                case 'image_url':
                    if (item.image_url) {
                        const imageUrl = typeof item.image_url === 'string'
                            ? item.image_url
                            : item.image_url.url;
                            
                        if (imageUrl.startsWith('data:')) {
                            // Handle base64 data URL
                            const [header, data] = imageUrl.split(',');
                            const mimeType = header.match(/data:([^;]+)/)?.[1] || 'image/jpeg';
                            parts.push({
                                inlineData: {
                                    mimeType,
                                    data
                                }
                            });
                        } else {
                            // Handle regular URL
                            parts.push({
                                fileData: {
                                    mimeType: 'image/jpeg', // Default MIME type
                                    fileUri: imageUrl
                                }
                            });
                        }
                    }
                    break;
                    
                case 'audio':
                    // Handle audio content
                    if (item.audio_url) {
                        const audioUrl = typeof item.audio_url === 'string'
                            ? item.audio_url
                            : item.audio_url.url;
                            
                        if (audioUrl.startsWith('data:')) {
                            const [header, data] = audioUrl.split(',');
                            const mimeType = header.match(/data:([^;]+)/)?.[1] || 'audio/wav';
                            parts.push({
                                inlineData: {
                                    mimeType,
                                    data
                                }
                            });
                        } else {
                            parts.push({
                                fileData: {
                                    mimeType: 'audio/wav', // Default MIME type
                                    fileUri: audioUrl
                                }
                            });
                        }
                    }
                    break;
            }
        });
        
        return parts;
    }
    
    return [];
}

function safeParseJSON(str) {
    if (!str) {
        return str;
    }
    let cleanedStr = str;

    // Handle possibly truncated escape sequences
    if (cleanedStr.endsWith('\\') && !cleanedStr.endsWith('\\\\')) {
        cleanedStr = cleanedStr.substring(0, cleanedStr.length - 1); // Remove dangling backslash
    } else if (cleanedStr.endsWith('\\u') || cleanedStr.endsWith('\\u0') || cleanedStr.endsWith('\\u00')) {
        // Incomplete Unicode escape sequence
        const idx = cleanedStr.lastIndexOf('\\u');
        cleanedStr = cleanedStr.substring(0, idx);
    }

    try {
        return JSON.parse(cleanedStr || '{}');
    } catch (e) {
        // If still unable to parse after cleaning, return original string or handle other errors
        return str;
    }
}

function buildToolConfig(toolChoice) {
    if (typeof toolChoice === 'string' && ['none', 'auto'].includes(toolChoice)) {
        return { functionCallingConfig: { mode: toolChoice.toUpperCase() } };
    }
    if (typeof toolChoice === 'object' && toolChoice.function) {
        return { functionCallingConfig: { mode: 'ANY', allowedFunctionNames: [toolChoice.function.name] } };
    }
    return null;
}

/**
 * Constructs Gemini functionResponse based on tool_result field
 * @param {Object} item - Tool result item
 * @returns {Object|null} functionResponse object
 */
function _buildFunctionResponse(item) {
    if (!item || typeof item !== 'object') {
        return null;
    }

    // Determine if it's a tool result
    const isResult = (
        item.type === "tool_result" ||
        item.tool_use_id !== undefined ||
        item.tool_output !== undefined ||
        item.result !== undefined ||
        item.content !== undefined
    );
    if (!isResult) {
        return null;
    }

    // Extract function name
    let funcName = null;

    // Method 1: Get from mapping table (Anthropic format)
    const toolUseId = item.tool_use_id || item.id;
    // Note: AnthropicConverter's internal _toolUseMapping is a private class property, cannot be directly accessed in convert.js
    // Therefore, we need to rely on the global toolStateManager
    // if (toolUseId && this._toolUseMapping) { // This code will not work in convert.js
    //     funcName = this._toolUseMapping[toolUseId];
    // }

    // Method 1.5: Use global tool state manager
    if (!funcName && toolUseId) {
        // First try to extract potential function name from ID
        let potentialFuncName = null;
        if (String(toolUseId).startsWith("call_")) {
            const nameAndHash = toolUseId.substring(4); // Remove "call_" prefix
            potentialFuncName = nameAndHash.substring(0, nameAndHash.lastIndexOf("_"));
        }

        // Check if global manager has corresponding mapping
        if (potentialFuncName) {
            const storedId = toolStateManager.getToolId(potentialFuncName);
            if (storedId === toolUseId) {
                funcName = potentialFuncName;
            }
        }
    }

    // Method 2: Extract from tool_use_id (OpenAI format)
    if (!funcName && toolUseId && String(toolUseId).startsWith("call_")) {
        // Format: call_<function_name>_<hash>, function name may contain multiple underscores
        const nameAndHash = toolUseId.substring(4); // Remove "call_" prefix
        funcName = nameAndHash.substring(0, nameAndHash.lastIndexOf("_")); // Remove last hash segment
    }

    // Method 3: Get directly from field
    if (!funcName) {
        funcName = (
            item.tool_name ||
            item.name ||
            item.function_name
        );
    }

    if (!funcName) {
        return null;
    }

    // Extract result content
    let funcResponse = null;

    // Try multiple possible result fields
    for (const key of ["content", "tool_output", "output", "response", "result"]) {
        if (item[key] !== undefined) {
            funcResponse = item[key];
            break;
        }
    }

    // If content is a list, try to extract text
    if (Array.isArray(funcResponse) && funcResponse.length > 0) {
        const textParts = funcResponse
            .filter(p => p && typeof p === 'object' && p.type === "text")
            .map(p => p.text || "");
        if (textParts.length > 0) {
            funcResponse = textParts.join("");
        }
    }

    // Ensure there is response content
    if (funcResponse === null || funcResponse === undefined) {
        funcResponse = "";
    }

    // Gemini requires response to be JSON object, wrap if it's a primitive string
    if (typeof funcResponse !== 'object') {
        funcResponse = { content: String(funcResponse) };
    }

    return {
        functionResponse: {
            name: funcName,
            response: funcResponse
        }
    };
}

/**
 * Converts a Gemini API model list response to a Claude API model list response.
 * @param {Object} geminiModels - The Gemini API model list response object.
 * @returns {Object} The formatted Claude API model list response.
 */
export function toClaudeModelListFromGemini(geminiModels) {
    return {
        models: geminiModels.models.map(m => ({
            name: m.name.startsWith('models/') ? m.name.substring(7) : m.name, // Remove 'models/' prefix as name
            // Claude models may contain other fields, using default values here
            description: "", // Gemini models don't provide description
            // Claude API may need other fields, adjust according to actual API documentation
        })),
    };
}

/**
 * Converts an OpenAI API model list response to a Claude API model list response.
 * @param {Object} openaiModels - The OpenAI API model list response object.
 * @returns {Object} The formatted Claude API model list response.
 */
export function toClaudeModelListFromOpenAI(openaiModels) {
    return {
        models: openaiModels.data.map(m => ({
            name: m.id, // Map OpenAI's id to Claude's name
            // Claude models may contain other fields, using default values here
            description: "", // OpenAI models don't provide description
            // Claude API may need other fields, adjust according to actual API documentation
        })),
    };
}

/**
 * Extracts thinking content from OpenAI text, returns Anthropic format content blocks
 * @param {string} text - Text content
 * @returns {string|Array} Extracted content
 */
function _extractThinkingFromOpenAIText(text) {
    // Match <thinking>...</thinking> tags
    const thinkingPattern = /<thinking>\s*(.*?)\s*<\/thinking>/gs;
    const matches = [...text.matchAll(thinkingPattern)];

    const contentBlocks = [];
    let lastEnd = 0;

    for (const match of matches) {
        // Add text before thinking tag (if any)
        const beforeText = text.substring(lastEnd, match.index).trim();
        if (beforeText) {
            contentBlocks.push({
                type: "text",
                text: beforeText
            });
        }

        // Add thinking content
        const thinkingText = match[1].trim();
        if (thinkingText) {
            contentBlocks.push({
                type: "thinking",
                thinking: thinkingText
            });
        }

        lastEnd = match.index + match[0].length;
    }

    // Add text after last thinking tag (if any)
    const afterText = text.substring(lastEnd).trim();
    if (afterText) {
        contentBlocks.push({
            type: "text",
            text: afterText
        });
    }

    // If no thinking tags found, return original text
    if (contentBlocks.length === 0) {
        return text;
    }

    // If only one text block, return string
    if (contentBlocks.length === 1 && contentBlocks[0].type === "text") {
        return contentBlocks[0].text;
    }

    return contentBlocks;
}

/**
 * Converts an OpenAI chat completion stream chunk to a Claude API messages stream chunk.
 * @param {Object} openaiChunk - The OpenAI API chat completion stream chunk object.
 * @param {string} [model] - Optional model name to include in the response.
 * @returns {Object} The formatted Claude API messages stream chunk.
 */
export function toClaudeStreamChunkFromOpenAI(openaiChunk, model) {
    if (!openaiChunk) {
        return null;
    }

    // Tool call
    if ( Array.isArray(openaiChunk)) {
        const toolCall = openaiChunk[0]; // Assume only one tool call is processed at a time
        if (toolCall) {
            if (toolCall.function && toolCall.function.name) {
                const toolUseBlock = {
                    type: "tool_use",
                    id: toolCall.id || `call_${toolCall.function.name}_${Date.now()}`,
                    name: toolCall.function.name,
                    input: toolCall.function.arguments ? JSON.parse(toolCall.function.arguments) : {}
                };
                return { type: "content_block_start", index: 1, content_block: toolUseBlock };
            }
        }
    }

    // Text content
    if (typeof openaiChunk === 'string') {
        return {
            type: "content_block_delta",
            index: 0,
            delta: {
                type: "text_delta",
                text: openaiChunk
            }
        };
    }
    return null;
}

function buildGenerationConfig({ temperature, max_tokens, top_p, stop }) {
    const config = {};
    config.temperature = checkAndAssignOrDefault(temperature, DEFAULT_TEMPERATURE);
    config.maxOutputTokens = checkAndAssignOrDefault(max_tokens, DEFAULT_GEMINI_MAX_TOKENS);
    config.topP = checkAndAssignOrDefault(top_p, DEFAULT_TOP_P);
    if (stop !== undefined) config.stopSequences = Array.isArray(stop) ? stop : [stop];
    return config;
}

/**
 * Converts an OpenAI chat completion request body to a Claude API request body.
 * Handles system instructions, tool calls, and multimodal content.
 * @param {Object} openaiRequest - The request body from the OpenAI API.
 * @returns {Object} The formatted request body for the Claude API.
 */
export function toClaudeRequestFromOpenAI(openaiRequest) {
    const messages = openaiRequest.messages || [];
    const { systemInstruction, nonSystemMessages } = extractAndProcessSystemMessages(messages);

    const claudeMessages = [];

    for (const message of nonSystemMessages) {
        const role = message.role === 'assistant' ? 'assistant' : 'user';
        let content = [];

        if (message.role === 'tool') {
            // Claude expects tool_result to be in a 'user' message
            // The content of a tool message is a single tool_result block
            content.push({
                type: 'tool_result',
                tool_use_id: message.tool_call_id, // Use tool_call_id from OpenAI tool message
                content: safeParseJSON(message.content) // Parse content as JSON if possible
            });
            claudeMessages.push({ role: 'user', content: content });
        } else if (message.role === 'assistant' && message.tool_calls?.length) {
            // Assistant message with tool calls - properly format as tool_use blocks
            // Claude expects tool_use to be in an 'assistant' message
            const toolUseBlocks = message.tool_calls.map(tc => ({
                type: 'tool_use',
                id: tc.id,
                name: tc.function.name,
                input: safeParseJSON(tc.function.arguments)
            }));
            claudeMessages.push({ role: 'assistant', content: toolUseBlocks });
        } else {
            // Regular user or assistant message (text and multimodal)
            if (typeof message.content === 'string') {
                if (message.content) {
                    content.push({ type: 'text', text: message.content });
                }
            } else if (Array.isArray(message.content)) {
                message.content.forEach(item => {
                    if (!item) return;
                    switch (item.type) {
                        case 'text':
                            if (item.text) {
                                content.push({ type: 'text', text: item.text });
                            }
                            break;
                        case 'image_url':
                            if (item.image_url) {
                                const imageUrl = typeof item.image_url === 'string'
                                    ? item.image_url
                                    : item.image_url.url;
                                if (imageUrl.startsWith('data:')) {
                                    const [header, data] = imageUrl.split(',');
                                    const mediaType = header.match(/data:([^;]+)/)?.[1] || 'image/jpeg';
                                    content.push({
                                        type: 'image',
                                        source: {
                                            type: 'base64',
                                            media_type: mediaType,
                                            data: data
                                        }
                                    });
                                } else {
                                    // Claude requires base64 for images, so for URLs, we'll represent as text
                                    content.push({ type: 'text', text: `[Image: ${imageUrl}]` });
                                }
                            }
                            break;
                        case 'audio':
                            // Handle audio content as text placeholder
                            if (item.audio_url) {
                                const audioUrl = typeof item.audio_url === 'string'
                                    ? item.audio_url
                                    : item.audio_url.url;
                                content.push({ type: 'text', text: `[Audio: ${audioUrl}]` });
                            }
                            break;
                    }
                });
            }
            // Only add message if content is not empty
            if (content.length > 0) {
                claudeMessages.push({ role: role, content: content });
            }
        }
    }

    const claudeRequest = {
        model: openaiRequest.model,
        messages: claudeMessages,
        max_tokens: checkAndAssignOrDefault(openaiRequest.max_tokens, DEFAULT_MAX_TOKENS),
        temperature: checkAndAssignOrDefault(openaiRequest.temperature, DEFAULT_TEMPERATURE),
        top_p: checkAndAssignOrDefault(openaiRequest.top_p, DEFAULT_TOP_P),
    };

    if (systemInstruction) {
        claudeRequest.system = extractTextFromMessageContent(systemInstruction.parts[0].text);
    }

    if (openaiRequest.tools?.length) {
        claudeRequest.tools = openaiRequest.tools.map(t => ({
            name: t.function.name,
            description: t.function.description || '',
            input_schema: t.function.parameters || { type: 'object', properties: {} }
        }));
        claudeRequest.tool_choice = buildClaudeToolChoice(openaiRequest.tool_choice);
    }

    return claudeRequest;
}

function buildClaudeToolChoice(toolChoice) {
    if (typeof toolChoice === 'string') {
        const mapping = { auto: 'auto', none: 'none', required: 'any' };
        return { type: mapping[toolChoice] };
    }
    if (typeof toolChoice === 'object' && toolChoice.function) {
        return { type: 'tool', name: toolChoice.function.name };
    }
    return undefined;
}

/**
 * Extracts and combines all 'system' role messages into a single system instruction.
 * Filters out system messages and returns the remaining non-system messages.
 * @param {Array<Object>} messages - Array of message objects from OpenAI request.
 * @returns {{systemInstruction: Object|null, nonSystemMessages: Array<Object>}}
 *          An object containing the system instruction and an array of non-system messages.
 */
export function extractAndProcessSystemMessages(messages) {
    const systemContents = [];
    const nonSystemMessages = [];

    for (const message of messages) {
        if (message.role === 'system') {
            systemContents.push(extractTextFromMessageContent(message.content));
        } else {
            nonSystemMessages.push(message);
        }
    }

    let systemInstruction = null;
    if (systemContents.length > 0) {
        systemInstruction = {
            parts: [{
                text: systemContents.join('\n')
            }]
        };
    }
    return { systemInstruction, nonSystemMessages };
}

/**
 * Extracts text from various forms of message content.
 * @param {string|Array<Object>} content - The content from a message object.
 * @returns {string} The extracted text.
 */
export function extractTextFromMessageContent(content) {
    if (typeof content === 'string') {
        return content;
    }
    if (Array.isArray(content)) {
        return content
            .filter(part => part.type === 'text' && part.text)
            .map(part => part.text)
            .join('\n');
    }
    return '';
}

/**
 * Converts a Claude API request body to a Gemini API request body.
 * Handles system instructions and multimodal content.
 * @param {Object} claudeRequest - The request body from the Claude API.
 * @returns {Object} The formatted request body for the Gemini API.
 */
export function toGeminiRequestFromClaude(claudeRequest) {
    // Ensure claudeRequest is a valid object
    if (!claudeRequest || typeof claudeRequest !== 'object') {
        console.warn("Invalid claudeRequest provided to toGeminiRequestFromClaude.");
        return { contents: [] };
    }

    const geminiRequest = {
        contents: []
    };

    // Handle system instruction
    if (claudeRequest.system) {
        let incomingSystemText = null;
        if (typeof claudeRequest.system === 'string') {
            incomingSystemText = claudeRequest.system;
        } else if (typeof claudeRequest.system === 'object') {
            incomingSystemText = JSON.stringify(claudeRequest.system);
        } else if (claudeRequest.messages?.length > 0) {
            // Fallback to first user message if no system property
            const userMessage = claudeRequest.messages.find(m => m.role === 'user');
            if (userMessage) {
                if (Array.isArray(userMessage.content)) {
                    incomingSystemText = userMessage.content.map(block => block.text).join('');
                } else {
                    incomingSystemText = userMessage.content;
                }
            }
        }
        geminiRequest.systemInstruction = {
            parts: [{ text: incomingSystemText}] // Ensure system is string
        };
    }

    // Process messages
    if (Array.isArray(claudeRequest.messages)) {
        claudeRequest.messages.forEach(message => {
            // Ensure message is a valid object and has a role and content
            if (!message || typeof message !== 'object' || !message.role || !message.content) {
                console.warn("Skipping invalid message in claudeRequest.messages.");
                return;
            }

            const geminiRole = message.role === 'assistant' ? 'model' : 'user';
            const processedParts = processClaudeContentToGeminiParts(message.content);

            // If the processed parts contain a function response, it should be a 'function' role message
            // Claude's tool_result block does not contain the function name, only tool_use_id.
            // We need to infer the function name from the previous tool_use message.
            // For simplicity in this conversion, we'll assume the tool_use_id is the function name
            // or that the tool_result is always preceded by a tool_use with the correct name.
            // A more robust solution would involve tracking tool_use_ids to function names.
            const functionResponsePart = processedParts.find(part => part.functionResponse);
            if (functionResponsePart) {
                geminiRequest.contents.push({
                    role: 'function',
                    parts: [functionResponsePart]
                });
            } else if (processedParts.length > 0) { // Only push if there are actual parts
                geminiRequest.contents.push({
                    role: geminiRole,
                    parts: processedParts
                });
            }
        });
    }

    // Add generation config
    const generationConfig = {};
    generationConfig.maxOutputTokens = checkAndAssignOrDefault(claudeRequest.max_tokens, DEFAULT_GEMINI_MAX_TOKENS);
    generationConfig.temperature = checkAndAssignOrDefault(claudeRequest.temperature, DEFAULT_TEMPERATURE);
    generationConfig.topP = checkAndAssignOrDefault(claudeRequest.top_p, DEFAULT_TOP_P);
    
    if (Object.keys(generationConfig).length > 0) {
        geminiRequest.generationConfig = generationConfig;
    }

    // Handle tools
    if (Array.isArray(claudeRequest.tools)) {
        geminiRequest.tools = [{
            functionDeclarations: claudeRequest.tools.map(tool => {
                // Ensure tool is a valid object and has a name
                if (!tool || typeof tool !== 'object' || !tool.name) {
                    console.warn("Skipping invalid tool declaration in claudeRequest.tools.");
                    return null; // Return null for invalid tools, filter out later
                }

                // Filter out TodoWrite tool
                // if (tool.name === 'TodoWrite') {
                //     console.log("Filtering out TodoWrite tool");
                //     return null;
                // }

                delete tool.input_schema.$schema;
                return {
                    name: String(tool.name), // Ensure name is string
                    description: String(tool.description || ''), // Ensure description is string
                    parameters: tool.input_schema && typeof tool.input_schema === 'object' ? tool.input_schema : { type: 'object', properties: {} }
                };
            }).filter(Boolean) // Filter out any nulls from invalid tool declarations
        }];
        // If no valid functionDeclarations, remove the tools array
        if (geminiRequest.tools[0].functionDeclarations.length === 0) {
            delete geminiRequest.tools;
        }
    }

    // Handle tool_choice
    if (claudeRequest.tool_choice) {
        geminiRequest.toolConfig = buildGeminiToolConfigFromClaude(claudeRequest.tool_choice);
    }

    return geminiRequest;
}

/**
 * Builds Gemini toolConfig from Claude tool_choice.
 * @param {Object} claudeToolChoice - The tool_choice object from Claude API.
 * @returns {Object|undefined} The formatted toolConfig for Gemini API, or undefined if invalid.
 */
function buildGeminiToolConfigFromClaude(claudeToolChoice) {
    if (!claudeToolChoice || typeof claudeToolChoice !== 'object' || !claudeToolChoice.type) {
        console.warn("Invalid claudeToolChoice provided to buildGeminiToolConfigFromClaude.");
        return undefined;
    }

    switch (claudeToolChoice.type) {
        case 'auto':
            return { functionCallingConfig: { mode: 'AUTO' } };
        case 'none':
            return { functionCallingConfig: { mode: 'NONE' } };
        case 'tool':
            if (claudeToolChoice.name && typeof claudeToolChoice.name === 'string') {
                return { functionCallingConfig: { mode: 'ANY', allowedFunctionNames: [claudeToolChoice.name] } };
            }
            console.warn("Invalid tool name in claudeToolChoice of type 'tool'.");
            return undefined;
        default:
            console.warn(`Unsupported claudeToolChoice type: ${claudeToolChoice.type}`);
            return undefined;
    }
}

/**
 * Processes Claude content to Gemini parts format with multimodal support.
 * @param {string|Array} content - Claude message content.
 * @returns {Array} Array of Gemini parts.
 */
function processClaudeContentToGeminiParts(content) {
    if (!content) return [];

    // Handle string content
    if (typeof content === 'string') {
        return [{ text: content }];
    }

    // Handle array content (multimodal)
    if (Array.isArray(content)) {
        const parts = [];

        content.forEach(block => {
            // Ensure block is a valid object and has a type
            if (!block || typeof block !== 'object' || !block.type) {
                console.warn("Skipping invalid content block in processClaudeContentToGeminiParts.");
                return;
            }

            switch (block.type) {
                case 'text':
                    if (typeof block.text === 'string') {
                        parts.push({ text: block.text });
                    } else {
                        console.warn("Invalid text content in Claude text block.");
                    }
                    break;

                case 'image':
                    if (block.source && typeof block.source === 'object' && block.source.type === 'base64' &&
                        typeof block.source.media_type === 'string' && typeof block.source.data === 'string') {
                        parts.push({
                            inlineData: {
                                mimeType: block.source.media_type,
                                data: block.source.data
                            }
                        });
                    } else {
                        console.warn("Invalid image source in Claude image block.");
                    }
                    break;

                case 'tool_use':
                    if (typeof block.name === 'string' && block.input && typeof block.input === 'object') {
                        // Filter out TodoWrite tool use
                        // if (block.name === 'TodoWrite') {
                        //     console.log("Filtering out TodoWrite tool use");
                        //     break; // Skip adding this tool to parts
                        // }
                        parts.push({
                            functionCall: {
                                name: block.name,
                                args: block.input
                            }
                        });
                    } else {
                        console.warn("Invalid tool_use block in Claude content.");
                    }
                    break;

                case 'tool_result':
                    // Claude's tool_result block does not contain the function name, only tool_use_id.
                    // Gemini's functionResponse requires a function name.
                    // For now, we'll use the tool_use_id as the name, but this is a potential point of failure
                    // if the tool_use_id is not the actual function name in Gemini's context.
                    // A more robust solution would involve tracking the function name from the tool_use block.
                    if (typeof block.tool_use_id === 'string') {
                        parts.push({
                            functionResponse: {
                                name: block.tool_use_id, // This might need to be the actual function name
                                response: { content: block.content } // content can be any JSON-serializable value
                            }
                        });
                    } else {
                        console.warn("Invalid tool_result block in Claude content: missing tool_use_id.");
                    }
                    break;

                default:
                    // Handle any other content types as text if they have a text property
                    if (typeof block.text === 'string') {
                        parts.push({ text: block.text });
                    } else {
                        console.warn(`Unsupported Claude content block type: ${block.type}. Skipping.`);
                    }
            }
        });

        return parts;
    }

    return [];
}

/**
 * Converts a Gemini API response to a Claude API messages response.
 * @param {Object} geminiResponse - The Gemini API response object.
 * @param {string} model - The model name to include in the response.
 * @returns {Object} The formatted Claude API messages response.
 */
export function toClaudeChatCompletionFromGemini(geminiResponse, model) {
    // Handle cases where geminiResponse or candidates are missing or empty
    if (!geminiResponse || !geminiResponse.candidates || geminiResponse.candidates.length === 0) {
        return {
            id: `msg_${uuidv4()}`,
            type: "message",
            role: "assistant",
            content: [], // Empty content for no candidates
            model: model,
            stop_reason: "end_turn", // Default stop reason
            stop_sequence: null,
            usage: {
                input_tokens: geminiResponse?.usageMetadata?.promptTokenCount || 0,
                output_tokens: geminiResponse?.usageMetadata?.candidatesTokenCount || 0
            }
        };
    }

    const candidate = geminiResponse.candidates[0];
    const content = processGeminiResponseToClaudeContent(geminiResponse);
    const finishReason = candidate.finishReason;
    let stopReason = "end_turn"; // Default stop reason

    if (finishReason) {
        switch (finishReason) {
            case 'STOP':
                stopReason = 'end_turn';
                break;
            case 'MAX_TOKENS':
                stopReason = 'max_tokens';
                break;
            case 'SAFETY':
                stopReason = 'safety';
                break;
            case 'RECITATION':
                stopReason = 'recitation';
                break;
            case 'OTHER':
                stopReason = 'other';
                break;
            default:
                stopReason = 'end_turn';
        }
    }

    return {
        id: `msg_${uuidv4()}`,
        type: "message",
        role: "assistant",
        content: content,
        model: model,
        stop_reason: stopReason,
        stop_sequence: null,
        usage: {
            input_tokens: geminiResponse.usageMetadata?.promptTokenCount || 0,
            output_tokens: geminiResponse.usageMetadata?.candidatesTokenCount || 0
        }
    };
}

/**
 * Processes Gemini response content to Claude format.
 * @param {Object} geminiResponse - The Gemini API response.
 * @returns {Array} Array of Claude content blocks.
 */
function processGeminiResponseToClaudeContent(geminiResponse) {
    if (!geminiResponse || !geminiResponse.candidates || geminiResponse.candidates.length === 0) return [];

    const content = [];

    for (const candidate of geminiResponse.candidates) {
        // Check if finish reason is error type
        if (candidate.finishReason && candidate.finishReason !== 'STOP') {
            // console.log('Gemini response finishReason:', JSON.stringify(candidate));
            // console.warn('Gemini response contains malformed function call:', candidate.finishMessage || 'No finish message');

            // Return error info as text content
            if (candidate.finishMessage) {
                content.push({
                    type: 'text',
                    text: `Error: ${candidate.finishMessage}`
                });
            }
            // console.log("Processed content:", content);
            continue; // Skip further processing of current candidate
        }

        if (candidate.content && candidate.content.parts) {
            for (const part of candidate.content.parts) {
                if (part.text) {
                    content.push({
                        type: 'text',
                        text: part.text
                    });
                } else if (part.inlineData) {
                    content.push({
                        type: 'image',
                        source: {
                            type: 'base64',
                            media_type: part.inlineData.mimeType,
                            data: part.inlineData.data
                        }
                    });
                } else if (part.functionCall) {
                    // Convert Gemini functionCall to Claude tool_use
                    content.push({
                        type: 'tool_use',
                        id: uuidv4(), // Generate a new ID for the tool use
                        name: part.functionCall.name,
                        input: part.functionCall.args || {}
                    });
                }
            }
        }
    }

    return content;
}

/**
 * Converts a Gemini API stream chunk to a Claude API messages stream chunk.
 * @param {Object} geminiChunk - The Gemini API stream chunk object.
 * @param {string} [model] - Optional model name to include in the response.
 * @returns {Object} The formatted Claude API messages stream chunk.
 */
export function toClaudeStreamChunkFromGemini(geminiChunk, model) {
    if (!geminiChunk) {
        return null;
    }

    if (typeof geminiChunk === 'string') {
        return {
            type: "content_block_delta",
            index: 0,
            delta: {
                type: "text_delta",
                text: geminiChunk
            }
        };
    }

    return null;
}


/**
 * Converts a Claude API response to an OpenAI Responses API response.
 * @param {Object} claudeResponse - The Claude API response object.
 * @param {string} model - The model name to include in the response.
 * @returns {Object} The formatted OpenAI Responses API response.
 */
export function toOpenAIResponsesFromClaude(claudeResponse, model) {
    // Restructure response according to reference example
    const content = processClaudeResponseContent(claudeResponse.content);
    const textContent = typeof content === 'string' ? content : JSON.stringify(content);

    // Convert Claude content to OpenAI Responses output format
    let output = [];

    // Add text content
    output.push({
        type: "message",
        id: `msg_${uuidv4().replace(/-/g, '')}`,
        summary: [],
        type: "message",
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
        reasoning: {
            // effort: "minimal",
            // summary: "detailed"
        },
        safety_identifier: "user-"+uuidv4().replace(/-/g, ''), // Example value
        service_tier: "default",
        status: "completed",
        store: false,
        temperature: 1,
        text: {
            format: {type: "text"},
            // verbosity: "medium"
        },
        tool_choice: "auto",
        tools: [],
        top_logprobs: 0,
        top_p: 1,
        truncation: "disabled",
        usage: {
            input_tokens: claudeResponse.usage?.input_tokens || 0, // Example value
            input_tokens_details: {
                cached_tokens: claudeResponse.usage?.cache_creation_input_tokens || 0, // Use if cache-related data exists
            },
            output_tokens: claudeResponse.usage?.output_tokens || 0, // Example value
            output_tokens_details: {
                reasoning_tokens: 0
            },
            total_tokens: (claudeResponse.usage?.input_tokens || 0) + (claudeResponse.usage?.output_tokens || 0) // Example value
        },
        user: null
    };
}

/**
 * Converts a Gemini API response to an OpenAI Responses API response.
 * @param {Object} geminiResponse - The Gemini API response object.
 * @param {string} model - The model name to include in the response.
 * @returns {Object} The formatted OpenAI Responses API response.
 */
export function toOpenAIResponsesFromGemini(geminiResponse, model) {
    // Restructure response according to reference example
    const content = processGeminiResponseContent(geminiResponse);
    const textContent = typeof content === 'string' ? content : JSON.stringify(content);

    // Convert Gemini content to OpenAI Responses output format
    let output = [];

    // Add text content
    output.push({
        id: `msg_${uuidv4().replace(/-/g, '')}`,
        summary: [],
        type: "message",
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
        model: model,
        object: "response",
        output: output,
        parallel_tool_calls: true,
        previous_response_id: null,
        prompt_cache_key: null,
        reasoning: {
            // effort: "minimal",
            // summary: "detailed"
        },
        safety_identifier: "user-"+uuidv4().replace(/-/g, ''), // Example value
        service_tier: "default",
        status: "completed",
        store: false,
        temperature: 1,
        text: {
            format: {type: "text"},
            // verbosity: "medium"
        },
        tool_choice: "auto",
        tools: [],
        top_logprobs: 0,
        top_p: 1,
        truncation: "disabled",
        usage: {
            input_tokens: geminiResponse.usageMetadata?.promptTokenCount || 0, // Example value
            input_tokens_details: {
                cached_tokens: geminiResponse.usageMetadata?.cachedTokens || 0, // Use correct Gemini cache field
            },
            output_tokens: geminiResponse.usageMetadata?.candidatesTokenCount || 0, // Example value
            output_tokens_details: {
                reasoning_tokens: 0
            },
            total_tokens: geminiResponse.usageMetadata?.totalTokenCount || 0, // Example value
        },
        user: null
    };
}


/**
 * Converts an OpenAI Responses API request body to a Claude API request body.
 * @param {Object} responsesRequest - The request body from the OpenAI Responses API.
 * @returns {Object} The formatted request body for the Claude API.
 */
export function toClaudeRequestFromOpenAIResponses(responsesRequest) {
    // The OpenAI Responses API uses input and instructions instead of messages
    const claudeRequest = {
        model: responsesRequest.model,
        max_tokens: checkAndAssignOrDefault(responsesRequest.max_tokens, DEFAULT_MAX_TOKENS),
        temperature: checkAndAssignOrDefault(responsesRequest.temperature, DEFAULT_TEMPERATURE),
        top_p: checkAndAssignOrDefault(responsesRequest.top_p, DEFAULT_TOP_P),
    };

    // Process instructions as system message
    if (responsesRequest.instructions) {
        claudeRequest.system = [];
        claudeRequest.system.push({
            text: typeof responsesRequest.instructions === 'string' ? responsesRequest.instructions : JSON.stringify(responsesRequest.instructions)
        });
        
    }

    const claudeMessages = [];
    // Process input as user message content
    if (responsesRequest.input) {
        if (typeof responsesRequest.input === 'string') {
            // Create user message with the string content
            claudeMessages.push({
                role: 'user',
                content: [{
                    type: 'text',
                    text: responsesRequest.input
                }]
            });
        } else {
            // Handle array of messages or items - process the entire array
            for (const message of responsesRequest.input) {
                const role = message.role === 'assistant' ? 'assistant' : 'user';
                let content = [];

                if (message.role === 'tool') {
                    // Claude expects tool_result to be in a 'user' message
                    // The content of a tool message is a single tool_result block
                    content.push({
                        type: 'tool_result',
                        tool_use_id: message.tool_call_id, // Use tool_call_id from OpenAI tool message
                        content: safeParseJSON(message.content) // Parse content as JSON if possible
                    });
                    claudeMessages.push({ role: 'user', content: content });
                } else if (message.role === 'assistant' && message.tool_calls?.length) {
                    // Assistant message with tool calls - properly format as tool_use blocks
                    // Claude expects tool_use to be in an 'assistant' message
                    const toolUseBlocks = message.tool_calls.map(tc => ({
                        type: 'tool_use',
                        id: tc.id,
                        name: tc.function.name,
                        input: safeParseJSON(tc.function.arguments)
                    }));
                    claudeMessages.push({ role: 'assistant', content: toolUseBlocks });
                } else {
                    // Regular user or assistant message (text and multimodal)
                    if (typeof message.content === 'string') {
                        if (message.content) {
                            content.push({ type: 'text', text: message.content });
                        }
                    } else if (Array.isArray(message.content)) {
                        message.content.forEach(item => {
                            if (!item) return;
                            switch (item.type) {
                                case 'input_text':
                                    if (item.text) {
                                        content.push({ type: 'text', text: item.text });
                                    }
                                    break;
                                case 'output_text':
                                    if (item.text) {
                                        content.push({ type: 'text', text: item.text });
                                    }
                                    break;
                                case 'image_url':
                                    if (item.image_url) {
                                        const imageUrl = typeof item.image_url === 'string'
                                            ? item.image_url
                                            : item.image_url.url;
                                        if (imageUrl.startsWith('data:')) {
                                            const [header, data] = imageUrl.split(',');
                                            const mediaType = header.match(/data:([^;]+)/)?.[1] || 'image/jpeg';
                                            content.push({
                                                type: 'image',
                                                source: {
                                                    type: 'base64',
                                                    media_type: mediaType,
                                                    data: data
                                                }
                                            });
                                        } else {
                                            // Claude requires base64 for images, so for URLs, we'll represent as text
                                            content.push({ type: 'text', text: `[Image: ${imageUrl}]` });
                                        }
                                    }
                                    break;
                                case 'audio':
                                    // Handle audio content as text placeholder
                                    if (item.audio_url) {
                                        const audioUrl = typeof item.audio_url === 'string'
                                            ? item.audio_url
                                            : item.audio_url.url;
                                        content.push({ type: 'text', text: `[Audio: ${audioUrl}]` });
                                    }
                                    break;
                            }
                        });
                    }
                    // Only add message if content is not empty
                    if (content.length > 0) {
                        claudeMessages.push({ role: role, content: content });
                    }
                }
            }
        }
    } 

    // Process tools if present
    // if (responsesRequest.tools && Array.isArray(responsesRequest.tools)) {
    //     claudeRequest.tools = responsesRequest.tools.map(tool => ({
    //             name: tool.name,
    //             description: tool.description || '',
    //             input_schema: tool.parameters || { type: 'object', properties: {} }
    //         }));
    //     claudeRequest.tool_choice = buildClaudeToolChoice(responsesRequest.tool_choice);
    // }

    // Process messages
    claudeRequest.messages = claudeMessages;
    claudeRequest.stream = responsesRequest.stream || false;
    return claudeRequest;
}

/**
 * Converts an OpenAI Responses API request body to a Gemini API request body.
 * @param {Object} responsesRequest - The request body from the OpenAI Responses API.
 * @returns {Object} The formatted request body for the Gemini API.
 */
export function toGeminiRequestFromOpenAIResponses(responsesRequest) {
    // The OpenAI Responses API uses input and instructions instead of messages
    const geminiRequest = {
        contents: []
    };

    // Process instructions as system instruction
    if (responsesRequest.instructions) {
        let instructionsText = '';
        if (typeof responsesRequest.instructions === 'string') {
            instructionsText = responsesRequest.instructions;
        } else {
            instructionsText = JSON.stringify(responsesRequest.instructions);
        }
        geminiRequest.systemInstruction = {
            parts: [{ text: instructionsText }]
        };
    }

    // Process input as user content
    if (responsesRequest.input) {
        let inputContent = '';
        if (typeof responsesRequest.input === 'string') {
            inputContent = responsesRequest.input;
        } else if (Array.isArray(responsesRequest.input)) {
            // Handle array of messages or items
            if (responsesRequest.input.length > 0) {
                // For compatibility, take the content of the last item with text content
                const lastInputItem = [...responsesRequest.input].reverse().find(item =>
                    item && (
                        (item.content && typeof item.content === 'string') ||
                        (item.content && Array.isArray(item.content) && item.content.some(c => c && c.text)) ||
                        (item.role === 'user' && item.content)
                    )
                );

                if (lastInputItem) {
                    if (typeof lastInputItem.content === 'string') {
                        inputContent = lastInputItem.content;
                    } else if (Array.isArray(lastInputItem.content)) {
                        // Process array of content blocks
                        inputContent = lastInputItem.content
                            .filter(block => block && block.text)
                            .map(block => block.text)
                            .join(' ');
                    } else {
                        // General fallback
                        inputContent = JSON.stringify(lastInputItem.content || lastInputItem);
                    }
                }
            }
        }

        if (inputContent) {
            // Add user message with the input content
            geminiRequest.contents.push({
                role: 'user',
                parts: [{ text: inputContent }]
            });
        }
    } else {
        // If no input is provided, ensure we have at least one user message for Gemini
        geminiRequest.contents.push({
            role: 'user',
            parts: [{ text: 'Hello' }]  // Default content to satisfy Gemini API requirement
        });
    }

    // Add generation config
    const generationConfig = {};
    generationConfig.maxOutputTokens = checkAndAssignOrDefault(responsesRequest.max_tokens, DEFAULT_GEMINI_MAX_TOKENS);
    generationConfig.temperature = checkAndAssignOrDefault(responsesRequest.temperature, DEFAULT_TEMPERATURE);
    generationConfig.topP = checkAndAssignOrDefault(responsesRequest.top_p, DEFAULT_TOP_P);

    if (Object.keys(generationConfig).length > 0) {
        geminiRequest.generationConfig = generationConfig;
    }

    // Process tools if present
    if (responsesRequest.tools && Array.isArray(responsesRequest.tools)) {
        geminiRequest.tools = [{
            functionDeclarations: responsesRequest.tools
                .filter(tool => tool && (tool.type === 'function' || tool.function))
                .map(tool => {
                    const func = tool.function || tool;
                    return {
                        name: String(func.name || tool.name || ''),
                        description: String(func.description || tool.description || ''),
                        parameters: func.parameters || tool.parameters || { type: 'object', properties: {} }
                    };
                }).filter(Boolean) // Filter out any invalid tools
        }];

        // If no valid functionDeclarations, remove the tools array
        if (geminiRequest.tools[0].functionDeclarations.length === 0) {
            delete geminiRequest.tools;
        }
    }

    return geminiRequest;
}

/**
 * Converts a Claude API stream chunk to an OpenAI Responses API stream chunk.
 * @param {Object} claudeChunk - The Claude API stream chunk object.
 * @param {string} [model] - Optional model name to include in the response.
 * @param {string} [requestId] - Optional request ID to maintain stream state across chunks.
 * @returns {Array} The formatted OpenAI Responses API stream chunks as an array of events.
 */
export function toOpenAIResponsesStreamChunkFromClaude(claudeChunk, model, requestId = null) {
    if (!claudeChunk) {
        return [];
    }

    // If no requestId provided, generate one (on first call)
    const id = requestId || Date.now().toString();

    // Set model info (only for new requests)
    if (!requestId) {
        streamStateManager.setModel(id, model);
    }

    // Handle text content from Claude stream
    let content = '';
    if (typeof claudeChunk === 'string') {
        content = claudeChunk;
    } else if (claudeChunk && typeof claudeChunk === 'object' && claudeChunk.delta?.text) {
        content = claudeChunk.delta.text;
    } else if (claudeChunk && typeof claudeChunk === 'object') {
        content = claudeChunk;
    }

    // For first data chunk (fullText is empty), generate start events
    const state = streamStateManager.getOrCreateState(id);
    if (state.fullText === '' && !requestId) { // Only generate start events on first call (when requestId not specified)
        // In this case, we need to add content to state first
        state.fullText = content;
        return [
            // ...getOpenAIResponsesStreamChunkBegin(id, model),
            generateOutputTextDelta(id, content),
            // ...getOpenAIResponsesStreamChunkEnd(id)
        ];
    } else if (content === '') {
        // If it's an end chunk, generate end events
        const doneEvents = getOpenAIResponsesStreamChunkEnd(id);

        // Cleanup state
        streamStateManager.cleanup(id);

        return doneEvents;
    } else {
        // Middle data chunk, only return delta event, but also update state
        streamStateManager.updateText(id, content);
        return [
            generateOutputTextDelta(id, content)
        ];
    }
}

/**
 * Converts a Gemini API stream chunk to an OpenAI Responses API stream chunk.
 * @param {Object} geminiChunk - The Gemini API stream chunk object.
 * @param {string} [model] - Optional model name to include in the response.
 * @param {string} [requestId] - Optional request ID to maintain stream state across chunks.
 * @returns {Array} The formatted OpenAI Responses API stream chunks as an array of events.
 */
export function toOpenAIResponsesStreamChunkFromGemini(geminiChunk, model, requestId = null) {
    if (!geminiChunk) {
        return [];
    }

    // If no requestId provided, generate one (on first call)
    const id = requestId || Date.now().toString();

    // Set model info (only for new requests)
    if (!requestId) {
        streamStateManager.setModel(id, model);
    }

    // Handle text content in stream
    let content = '';
    if (typeof geminiChunk === 'string') {
        content = geminiChunk;
    } else if (geminiChunk && typeof geminiChunk === 'object') {
        // Extract content from Gemini chunk if it's an object
        content = geminiChunk.content || geminiChunk.text || geminiChunk;
    }

    // For first data chunk (fullText is empty), generate start events
    const state = streamStateManager.getOrCreateState(id);
    if (state.fullText === '' && !requestId) { // Only generate start events on first call (when requestId not specified)
        // In this case, we need to add content to state first
        state.fullText = content;
        return [
            // ...getOpenAIResponsesStreamChunkBegin(id, model),
            generateOutputTextDelta(id, content),
            // ...getOpenAIResponsesStreamChunkEnd(id)
        ];
    } else if (content === '') {
        // If it's an end chunk, generate end events
        const doneEvents = getOpenAIResponsesStreamChunkEnd(id);

        // Cleanup state
        streamStateManager.cleanup(id);

        return doneEvents;
    } else {
        // Middle data chunk, only return delta event, but also update state
        streamStateManager.updateText(id, content);
        return [
            generateOutputTextDelta(id, content)
        ];
    }
}

export function getOpenAIStreamChunkStop(model) {
    return {
        id: `chatcmpl-${uuidv4()}`, // uuidv4 needs to be imported or handled
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

export function  getOpenAIResponsesStreamChunkBegin(id, model){

    return [
        generateResponseCreated(id, model),
        generateResponseInProgress(id),
        generateOutputItemAdded(id),
        generateContentPartAdded(id)
    ];
}

export function  getOpenAIResponsesStreamChunkEnd(id){

    return [
        generateOutputTextDone(id),
        generateContentPartDone(id),
        generateOutputItemDone(id),
        generateResponseCompleted(id)
    ];
}