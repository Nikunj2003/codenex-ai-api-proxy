import { ProviderStrategy } from '../provider-strategy.js';
import { extractSystemPromptFromRequestBody, MODEL_PROTOCOL_PREFIX } from '../common.js';

/**
 * Claude Code provider strategy implementation.
 * Handles request/response processing for Claude Code via ai-sdk-provider-claude-code.
 */
class ClaudeCodeStrategy extends ProviderStrategy {
    /**
     * Extracts model and stream information from the request.
     * @param {object} req - HTTP request object.
     * @param {object} requestBody - Parsed request body.
     * @returns {{model: string, isStream: boolean}} Object containing model name and stream status.
     */
    extractModelAndStreamInfo(req, requestBody) {
        const model = requestBody.model || 'sonnet';
        const isStream = requestBody.stream === true;
        return { model, isStream };
    }

    /**
     * Extracts text content from the Claude Code response.
     * Handles OpenAI-compatible format (both streaming and non-streaming).
     * @param {object} response - API response object.
     * @returns {string} Extracted text content.
     */
    extractResponseText(response) {
        // Handle OpenAI streaming chunk format (delta.content)
        if (response.choices && response.choices[0]?.delta?.content) {
            return response.choices[0].delta.content;
        }

        // Handle OpenAI non-streaming format (message.content)
        if (response.choices && response.choices[0]?.message?.content) {
            return response.choices[0].message.content;
        }

        return '';
    }

    /**
     * Extracts prompt text from the request body.
     * @param {object} requestBody - Request body object.
     * @returns {string} Extracted prompt text.
     */
    extractPromptText(requestBody) {
        if (requestBody.messages && requestBody.messages.length > 0) {
            const lastMessage = requestBody.messages[requestBody.messages.length - 1];
            if (lastMessage.content && Array.isArray(lastMessage.content)) {
                return lastMessage.content.map(block => block.text).join('');
            }
            return lastMessage.content;
        }
        return '';
    }

    /**
     * Applies system prompt from file to the request body.
     * Claude Code uses the same format as Claude API.
     * @param {object} config - Configuration object.
     * @param {object} requestBody - Request body object.
     * @returns {Promise<object>} Modified request body.
     */
    async applySystemPromptFromFile(config, requestBody) {
        if (!config.SYSTEM_PROMPT_FILE_PATH) {
            return requestBody;
        }

        const filePromptContent = config.SYSTEM_PROMPT_CONTENT;
        if (filePromptContent === null) {
            return requestBody;
        }

        const existingSystemText = extractSystemPromptFromRequestBody(requestBody, MODEL_PROTOCOL_PREFIX.CLAUDE_CODE);

        const newSystemText = config.SYSTEM_PROMPT_MODE === 'append' && existingSystemText
            ? `${existingSystemText}\n${filePromptContent}`
            : filePromptContent;

        requestBody.system = newSystemText;
        console.log(`[System Prompt] Applied system prompt from ${config.SYSTEM_PROMPT_FILE_PATH} in '${config.SYSTEM_PROMPT_MODE}' mode for provider 'claudeCode'.`);

        return requestBody;
    }

    /**
     * Manages the system prompt file.
     * @param {object} requestBody - Request body object.
     * @returns {Promise<void>}
     */
    async manageSystemPrompt(requestBody) {
        const incomingSystemText = extractSystemPromptFromRequestBody(requestBody, MODEL_PROTOCOL_PREFIX.CLAUDE_CODE);
        await this._updateSystemPromptFile(incomingSystemText, MODEL_PROTOCOL_PREFIX.CLAUDE_CODE);
    }
}

export { ClaudeCodeStrategy };
