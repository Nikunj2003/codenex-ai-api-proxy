import { claudeCode } from 'ai-sdk-provider-claude-code';
import { generateText, streamText } from 'ai';

/**
 * Claude Code API Service Class.
 * Encapsulates the interaction logic with Claude Code via ai-sdk-provider-claude-code.
 */
export class ClaudeCodeApiService {
    /**
     * Constructor
     * @param {object} config - Service configuration.
     */
    constructor(config) {
        this.config = config;
        console.log('[ClaudeCode] Service initialized');
    }

    /**
     * Convert OpenAI-style messages to prompt string
     * @param {Array} messages - Array of message objects
     * @returns {string} Combined prompt string
     */
    _messagesToPrompt(messages) {
        if (!messages || !Array.isArray(messages)) {
            return '';
        }
        return messages.map(m => {
            if (m.role === 'system') return `System: ${m.content}`;
            if (m.role === 'user') return `Human: ${m.content}`;
            if (m.role === 'assistant') return `Assistant: ${m.content}`;
            return m.content;
        }).join('\n\n');
    }

    /**
     * Map model name to Claude Code shorthand
     * @param {string} model - Model name from request
     * @returns {string} Claude Code model shorthand
     */
    _getModelName(model) {
        const modelMap = {
            'opus': 'opus',
            'sonnet': 'sonnet',
            'haiku': 'haiku',
            'claude-opus': 'opus',
            'claude-sonnet': 'sonnet',
            'claude-haiku': 'haiku',
            'claude-code-opus': 'opus',
            'claude-code-sonnet': 'sonnet',
            'claude-code-haiku': 'haiku'
        };
        return modelMap[model] || model;
    }

    /**
     * Generates content (non-streaming).
     * @param {string} model - Model name.
     * @param {object} requestBody - Request body (OpenAI/Claude format).
     * @returns {Promise<object>} Claude API compatible response.
     */
    async generateContent(model, requestBody) {
        const modelName = this._getModelName(model);
        const prompt = this._messagesToPrompt(requestBody.messages || []);

        console.log(`[ClaudeCode] Generating content with model: ${modelName}`);

        try {
            const result = await generateText({
                model: claudeCode(modelName),
                prompt: prompt
            });

            // Return in OpenAI-compatible format for /v1/chat/completions
            return {
                id: `chatcmpl-${Date.now()}`,
                object: 'chat.completion',
                created: Math.floor(Date.now() / 1000),
                model: model,
                choices: [{
                    index: 0,
                    message: {
                        role: 'assistant',
                        content: result.text
                    },
                    finish_reason: 'stop'
                }],
                usage: {
                    prompt_tokens: result.usage?.promptTokens || 0,
                    completion_tokens: result.usage?.completionTokens || 0,
                    total_tokens: (result.usage?.promptTokens || 0) + (result.usage?.completionTokens || 0)
                }
            };
        } catch (error) {
            console.error('[ClaudeCode] Error generating content:', error.message);
            throw error;
        }
    }

    /**
     * Streams content generation.
     * @param {string} model - Model name.
     * @param {object} requestBody - Request body (OpenAI/Claude format).
     * @returns {AsyncIterable<object>} Claude API compatible response stream.
     */
    async *generateContentStream(model, requestBody) {
        const modelName = this._getModelName(model);
        const prompt = this._messagesToPrompt(requestBody.messages || []);
        const chatId = `chatcmpl-${Date.now()}`;
        const created = Math.floor(Date.now() / 1000);

        console.log(`[ClaudeCode] Streaming content with model: ${modelName}`);

        try {
            const result = streamText({
                model: claudeCode(modelName),
                prompt: prompt
            });

            // Stream in OpenAI format for /v1/chat/completions
            for await (const chunk of result.textStream) {
                yield {
                    id: chatId,
                    object: 'chat.completion.chunk',
                    created: created,
                    model: model,
                    choices: [{
                        index: 0,
                        delta: {
                            content: chunk
                        },
                        finish_reason: null
                    }]
                };
            }

            // Final chunk with finish_reason
            yield {
                id: chatId,
                object: 'chat.completion.chunk',
                created: created,
                model: model,
                choices: [{
                    index: 0,
                    delta: {},
                    finish_reason: 'stop'
                }]
            };
        } catch (error) {
            console.error('[ClaudeCode] Error streaming content:', error.message);
            throw error;
        }
    }

    /**
     * Lists available models.
     * @returns {Promise<object>} List of models.
     */
    async listModels() {
        console.log('[ClaudeCode] Listing available models.');
        const models = [
            { id: 'opus', name: 'opus', description: 'Most powerful Claude model for complex tasks' },
            { id: 'sonnet', name: 'sonnet', description: 'Balanced Claude model for most tasks' },
            { id: 'haiku', name: 'haiku', description: 'Fastest and most cost-effective Claude model' }
        ];

        return { models: models.map(m => ({ name: m.name })) };
    }
}
