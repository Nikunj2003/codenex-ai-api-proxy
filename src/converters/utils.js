/**
 * Converter Common Utility Functions Module
 * Provides general helper functions needed for various protocol conversions
 */

import { v4 as uuidv4 } from 'uuid';

// =============================================================================
// Constant Definitions
// =============================================================================

// Common default values
export const DEFAULT_MAX_TOKENS = 8192;
export const DEFAULT_TEMPERATURE = 1;
export const DEFAULT_TOP_P = 0.95;

// =============================================================================
// OpenAI Related Constants
// =============================================================================
export const OPENAI_DEFAULT_MAX_TOKENS = 128000;
export const OPENAI_DEFAULT_TEMPERATURE = 1;
export const OPENAI_DEFAULT_TOP_P = 0.95;
export const OPENAI_DEFAULT_INPUT_TOKEN_LIMIT = 32768;
export const OPENAI_DEFAULT_OUTPUT_TOKEN_LIMIT = 128000;

// =============================================================================
// Claude Related Constants
// =============================================================================
export const CLAUDE_DEFAULT_MAX_TOKENS = 200000;
export const CLAUDE_DEFAULT_TEMPERATURE = 1;
export const CLAUDE_DEFAULT_TOP_P = 0.95;

// =============================================================================
// Gemini Related Constants
// =============================================================================
export const GEMINI_DEFAULT_MAX_TOKENS = 65534;
export const GEMINI_MAX_OUTPUT_TOKENS_LIMIT = 65536; // Hard limit from Gemini API
export const GEMINI_DEFAULT_TEMPERATURE = 1;
export const GEMINI_DEFAULT_TOP_P = 0.95;
export const GEMINI_DEFAULT_INPUT_TOKEN_LIMIT = 32768;
export const GEMINI_DEFAULT_OUTPUT_TOKEN_LIMIT = 65534;

// =============================================================================
// OpenAI Responses Related Constants
// =============================================================================
export const OPENAI_RESPONSES_DEFAULT_MAX_TOKENS = 128000;
export const OPENAI_RESPONSES_DEFAULT_TEMPERATURE = 1;
export const OPENAI_RESPONSES_DEFAULT_TOP_P = 0.95;
export const OPENAI_RESPONSES_DEFAULT_INPUT_TOKEN_LIMIT = 32768;
export const OPENAI_RESPONSES_DEFAULT_OUTPUT_TOKEN_LIMIT = 128000;

// =============================================================================
// Ollama Related Constants
// =============================================================================
export const OLLAMA_DEFAULT_CONTEXT_LENGTH = 65534;
export const OLLAMA_DEFAULT_MAX_OUTPUT_TOKENS = 8192;

// Claude model context length
export const OLLAMA_CLAUDE_DEFAULT_CONTEXT_LENGTH = 200000;
export const OLLAMA_CLAUDE_SONNET_45_CONTEXT_LENGTH = 200000;
export const OLLAMA_CLAUDE_SONNET_45_MAX_OUTPUT_TOKENS = 200000;
export const OLLAMA_CLAUDE_HAIKU_45_CONTEXT_LENGTH = 200000;
export const OLLAMA_CLAUDE_HAIKU_45_MAX_OUTPUT_TOKENS = 200000;
export const OLLAMA_CLAUDE_OPUS_41_CONTEXT_LENGTH = 200000;
export const OLLAMA_CLAUDE_OPUS_41_MAX_OUTPUT_TOKENS = 32000;
export const OLLAMA_CLAUDE_SONNET_40_CONTEXT_LENGTH = 200000;
export const OLLAMA_CLAUDE_SONNET_40_MAX_OUTPUT_TOKENS = 200000;
export const OLLAMA_CLAUDE_SONNET_37_CONTEXT_LENGTH = 200000;
export const OLLAMA_CLAUDE_SONNET_37_MAX_OUTPUT_TOKENS = 200000;
export const OLLAMA_CLAUDE_OPUS_40_CONTEXT_LENGTH = 200000;
export const OLLAMA_CLAUDE_OPUS_40_MAX_OUTPUT_TOKENS = 32000;
export const OLLAMA_CLAUDE_HAIKU_35_CONTEXT_LENGTH = 200000;
export const OLLAMA_CLAUDE_HAIKU_35_MAX_OUTPUT_TOKENS = 200000;
export const OLLAMA_CLAUDE_HAIKU_30_CONTEXT_LENGTH = 200000;
export const OLLAMA_CLAUDE_HAIKU_30_MAX_OUTPUT_TOKENS = 8192;
export const OLLAMA_CLAUDE_SONNET_35_CONTEXT_LENGTH = 200000;
export const OLLAMA_CLAUDE_SONNET_35_MAX_OUTPUT_TOKENS = 200000;
export const OLLAMA_CLAUDE_OPUS_30_CONTEXT_LENGTH = 200000;
export const OLLAMA_CLAUDE_OPUS_30_MAX_OUTPUT_TOKENS = 8192;

// Gemini model context length
export const OLLAMA_GEMINI_25_PRO_CONTEXT_LENGTH = 1048576;
export const OLLAMA_GEMINI_25_PRO_MAX_OUTPUT_TOKENS = 65534;
export const OLLAMA_GEMINI_25_FLASH_CONTEXT_LENGTH = 1048576;
export const OLLAMA_GEMINI_25_FLASH_MAX_OUTPUT_TOKENS = 65534;
export const OLLAMA_GEMINI_25_IMAGE_CONTEXT_LENGTH = 65534;
export const OLLAMA_GEMINI_25_IMAGE_MAX_OUTPUT_TOKENS = 32768;
export const OLLAMA_GEMINI_25_LIVE_CONTEXT_LENGTH = 131072;
export const OLLAMA_GEMINI_25_LIVE_MAX_OUTPUT_TOKENS = 65534;
export const OLLAMA_GEMINI_25_TTS_CONTEXT_LENGTH = 65534;
export const OLLAMA_GEMINI_25_TTS_MAX_OUTPUT_TOKENS = 16384;
export const OLLAMA_GEMINI_20_FLASH_CONTEXT_LENGTH = 1048576;
export const OLLAMA_GEMINI_20_FLASH_MAX_OUTPUT_TOKENS = 65534;
export const OLLAMA_GEMINI_20_IMAGE_CONTEXT_LENGTH = 32768;
export const OLLAMA_GEMINI_20_IMAGE_MAX_OUTPUT_TOKENS = 65534;
export const OLLAMA_GEMINI_15_PRO_CONTEXT_LENGTH = 2097152;
export const OLLAMA_GEMINI_15_PRO_MAX_OUTPUT_TOKENS = 65534;
export const OLLAMA_GEMINI_15_FLASH_CONTEXT_LENGTH = 1048576;
export const OLLAMA_GEMINI_15_FLASH_MAX_OUTPUT_TOKENS = 65534;
export const OLLAMA_GEMINI_DEFAULT_CONTEXT_LENGTH = 1048576;
export const OLLAMA_GEMINI_DEFAULT_MAX_OUTPUT_TOKENS = 65534;

// GPT model context length
export const OLLAMA_GPT4_TURBO_CONTEXT_LENGTH = 128000;
export const OLLAMA_GPT4_TURBO_MAX_OUTPUT_TOKENS = 8192;
export const OLLAMA_GPT4_32K_CONTEXT_LENGTH = 32768;
export const OLLAMA_GPT4_32K_MAX_OUTPUT_TOKENS = 8192;
export const OLLAMA_GPT4_BASE_CONTEXT_LENGTH = 200000;
export const OLLAMA_GPT4_BASE_MAX_OUTPUT_TOKENS = 8192;
export const OLLAMA_GPT35_16K_CONTEXT_LENGTH = 16385;
export const OLLAMA_GPT35_16K_MAX_OUTPUT_TOKENS = 8192;
export const OLLAMA_GPT35_BASE_CONTEXT_LENGTH = 8192;
export const OLLAMA_GPT35_BASE_MAX_OUTPUT_TOKENS = 8192;

// Qwen model context length
export const OLLAMA_QWEN_CODER_PLUS_CONTEXT_LENGTH = 128000;
export const OLLAMA_QWEN_CODER_PLUS_MAX_OUTPUT_TOKENS = 65534;
export const OLLAMA_QWEN_VL_PLUS_CONTEXT_LENGTH = 262144;
export const OLLAMA_QWEN_VL_PLUS_MAX_OUTPUT_TOKENS = 32768;
export const OLLAMA_QWEN_CODER_FLASH_CONTEXT_LENGTH = 128000;
export const OLLAMA_QWEN_CODER_FLASH_MAX_OUTPUT_TOKENS = 65534;
export const OLLAMA_QWEN_DEFAULT_CONTEXT_LENGTH = 32768;
export const OLLAMA_QWEN_DEFAULT_MAX_OUTPUT_TOKENS = 200000;

export const OLLAMA_DEFAULT_FILE_TYPE = 2;
export const OLLAMA_DEFAULT_QUANTIZATION_VERSION = 2;
export const OLLAMA_DEFAULT_ROPE_FREQ_BASE = 10000.0;
export const OLLAMA_DEFAULT_TEMPERATURE = 0.7;
export const OLLAMA_DEFAULT_TOP_P = 0.9;
export const OLLAMA_DEFAULT_QUANTIZATION_LEVEL = 'Q4_0';
export const OLLAMA_SHOW_QUANTIZATION_LEVEL = 'Q4_K_M';

// =============================================================================
// Common Helper Functions
// =============================================================================

/**
 * Check if value is undefined or 0, and return default value
 * @param {*} value - The value to check
 * @param {*} defaultValue - Default value
 * @returns {*} Processed value
 */
export function checkAndAssignOrDefault(value, defaultValue) {
    if (value !== undefined && value !== 0) {
        return value;
    }
    return defaultValue;
}

/**
 * Generate unique ID
 * @param {string} prefix - ID prefix
 * @returns {string} Generated ID
 */
export function generateId(prefix = '') {
    return prefix ? `${prefix}_${uuidv4()}` : uuidv4();
}

/**
 * Safely parse JSON string
 * @param {string} str - JSON string
 * @returns {*} Parsed object or original string
 */
export function safeParseJSON(str) {
    if (!str) {
        return str;
    }
    let cleanedStr = str;

    // Handle potentially truncated escape sequences
    if (cleanedStr.endsWith('\\') && !cleanedStr.endsWith('\\\\')) {
        cleanedStr = cleanedStr.substring(0, cleanedStr.length - 1);
    } else if (cleanedStr.endsWith('\\u') || cleanedStr.endsWith('\\u0') || cleanedStr.endsWith('\\u00')) {
        const idx = cleanedStr.lastIndexOf('\\u');
        cleanedStr = cleanedStr.substring(0, idx);
    }

    try {
        return JSON.parse(cleanedStr || '{}');
    } catch (e) {
        return str;
    }
}

/**
 * Extract text from message content
 * @param {string|Array} content - Message content
 * @returns {string} Extracted text
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
 * Extract and process system messages
 * @param {Array} messages - Messages array
 * @returns {{systemInstruction: Object|null, nonSystemMessages: Array}}
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
 * Clean JSON Schema properties (remove properties not supported by Gemini)
 * @param {Object} schema - JSON Schema
 * @returns {Object} Cleaned JSON Schema
 */
export function cleanJsonSchemaProperties(schema) {
    if (!schema || typeof schema !== 'object') {
        return schema;
    }

    const sanitized = {};
    for (const [key, value] of Object.entries(schema)) {
        if (["type", "description", "properties", "required", "enum", "items"].includes(key)) {
            sanitized[key] = value;
        }
    }

    if (sanitized.properties && typeof sanitized.properties === 'object') {
        const cleanProperties = {};
        for (const [propName, propSchema] of Object.entries(sanitized.properties)) {
            cleanProperties[propName] = cleanJsonSchemaProperties(propSchema);
        }
        sanitized.properties = cleanProperties;
    }

    if (sanitized.items) {
        sanitized.items = cleanJsonSchemaProperties(sanitized.items);
    }

    return sanitized;
}

/**
 * Map finish reason
 * @param {string} reason - Finish reason
 * @param {string} sourceFormat - Source format
 * @param {string} targetFormat - Target format
 * @returns {string} Mapped finish reason
 */
export function mapFinishReason(reason, sourceFormat, targetFormat) {
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
                STOP: "end_turn",
                MAX_TOKENS: "max_tokens",
                SAFETY: "stop_sequence",
                RECITATION: "stop_sequence",
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
 * Intelligently determine OpenAI reasoning_effort level based on budget_tokens
 * @param {number|null} budgetTokens - Anthropic thinking budget_tokens value
 * @returns {string} OpenAI reasoning_effort level
 */
export function determineReasoningEffortFromBudget(budgetTokens) {
    if (budgetTokens === null || budgetTokens === undefined) {
        console.info("No budget_tokens provided, defaulting to reasoning_effort='high'");
        return "high";
    }

    const LOW_THRESHOLD = 50;
    const HIGH_THRESHOLD = 200;

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

/**
 * Extract thinking content from OpenAI text
 * @param {string} text - Text content
 * @returns {string|Array} Extracted content
 */
export function extractThinkingFromOpenAIText(text) {
    const thinkingPattern = /<thinking>\s*(.*?)\s*<\/thinking>/gs;
    const matches = [...text.matchAll(thinkingPattern)];

    const contentBlocks = [];
    let lastEnd = 0;

    for (const match of matches) {
        const beforeText = text.substring(lastEnd, match.index).trim();
        if (beforeText) {
            contentBlocks.push({
                type: "text",
                text: beforeText
            });
        }

        const thinkingText = match[1].trim();
        if (thinkingText) {
            contentBlocks.push({
                type: "thinking",
                thinking: thinkingText
            });
        }

        lastEnd = match.index + match[0].length;
    }

    const afterText = text.substring(lastEnd).trim();
    if (afterText) {
        contentBlocks.push({
            type: "text",
            text: afterText
        });
    }

    if (contentBlocks.length === 0) {
        return text;
    }

    if (contentBlocks.length === 1 && contentBlocks[0].type === "text") {
        return contentBlocks[0].text;
    }

    return contentBlocks;
}

// =============================================================================
// Tool State Manager (Singleton Pattern)
// =============================================================================

/**
 * Global tool state manager
 */
class ToolStateManager {
    constructor() {
        if (ToolStateManager.instance) {
            return ToolStateManager.instance;
        }
        ToolStateManager.instance = this;
        this._toolMappings = {};
        return this;
    }

    storeToolMapping(funcName, toolId) {
        this._toolMappings[funcName] = toolId;
    }

    getToolId(funcName) {
        return this._toolMappings[funcName] || null;
    }

    clearMappings() {
        this._toolMappings = {};
    }
}

export const toolStateManager = new ToolStateManager();