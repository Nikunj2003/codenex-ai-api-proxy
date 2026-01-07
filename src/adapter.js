import { OpenAIResponsesApiService } from './openai/openai-responses-core.js'; // Import OpenAIResponsesApiService
import { GeminiApiService } from './gemini/gemini-core.js'; // Import geminiApiService
import { AntigravityApiService } from './gemini/antigravity-core.js'; // Import AntigravityApiService
import { OpenAIApiService } from './openai/openai-core.js'; // Import OpenAIApiService
import { ClaudeApiService } from './claude/claude-core.js'; // Import ClaudeApiService
import { ClaudeCodeApiService } from './claude-code/claude-code-core.js'; // Import ClaudeCodeApiService
import { MODEL_PROVIDER } from './common.js'; // Import MODEL_PROVIDER

// Define AI service adapter interface
// All service adapters should implement these methods
export class ApiServiceAdapter {
    constructor() {
        if (new.target === ApiServiceAdapter) {
            throw new TypeError("Cannot construct ApiServiceAdapter instances directly");
        }
    }

    /**
     * Generate content
     * @param {string} model - Model name
     * @param {object} requestBody - Request body
     * @returns {Promise<object>} - API response
     */
    async generateContent(model, requestBody) {
        throw new Error("Method 'generateContent()' must be implemented.");
    }

    /**
     * Stream generate content
     * @param {string} model - Model name
     * @param {object} requestBody - Request body
     * @returns {AsyncIterable<object>} - API response stream
     */
    async *generateContentStream(model, requestBody) {
        throw new Error("Method 'generateContentStream()' must be implemented.");
    }

    /**
     * List available models
     * @returns {Promise<object>} - Model list
     */
    async listModels() {
        throw new Error("Method 'listModels()' must be implemented.");
    }

    /**
     * Refresh authentication token
     * @returns {Promise<void>}
     */
    async refreshToken() {
        throw new Error("Method 'refreshToken()' must be implemented.");
    }
}

// Gemini API service adapter
export class GeminiApiServiceAdapter extends ApiServiceAdapter {
    constructor(config) {
        super();
        this.geminiApiService = new GeminiApiService(config);
        // this.geminiApiService.initialize().catch(error => {
        //     console.error("Failed to initialize geminiApiService:", error);
        // });
    }

    async generateContent(model, requestBody) {
        if (!this.geminiApiService.isInitialized) {
            console.warn("geminiApiService not initialized, attempting to re-initialize...");
            await this.geminiApiService.initialize();
        }
        return this.geminiApiService.generateContent(model, requestBody);
    }

    async *generateContentStream(model, requestBody) {
        if (!this.geminiApiService.isInitialized) {
            console.warn("geminiApiService not initialized, attempting to re-initialize...");
            await this.geminiApiService.initialize();
        }
        yield* this.geminiApiService.generateContentStream(model, requestBody);
    }

    async listModels() {
        if (!this.geminiApiService.isInitialized) {
            console.warn("geminiApiService not initialized, attempting to re-initialize...");
            await this.geminiApiService.initialize();
        }
        // Gemini Core API's listModels already returns data in Gemini format, so no additional conversion is needed
        return this.geminiApiService.listModels();
    }

    async refreshToken() {
        if(this.geminiApiService.isExpiryDateNear()===true){
            console.log(`[Gemini] Expiry date is near, refreshing token...`);
            return this.geminiApiService.initializeAuth(true);
        }
        return Promise.resolve();
    }

    /**
     * Get usage limits information
     * @returns {Promise<Object>} Usage limits information
     */
    async getUsageLimits() {
        if (!this.geminiApiService.isInitialized) {
            console.warn("geminiApiService not initialized, attempting to re-initialize...");
            await this.geminiApiService.initialize();
        }
        return this.geminiApiService.getUsageLimits();
    }
}

// Antigravity API service adapter
export class AntigravityApiServiceAdapter extends ApiServiceAdapter {
    constructor(config) {
        super();
        this.antigravityApiService = new AntigravityApiService(config);
    }

    async generateContent(model, requestBody) {
        if (!this.antigravityApiService.isInitialized) {
            console.warn("antigravityApiService not initialized, attempting to re-initialize...");
            await this.antigravityApiService.initialize();
        }
        return this.antigravityApiService.generateContent(model, requestBody);
    }

    async *generateContentStream(model, requestBody) {
        if (!this.antigravityApiService.isInitialized) {
            console.warn("antigravityApiService not initialized, attempting to re-initialize...");
            await this.antigravityApiService.initialize();
        }
        yield* this.antigravityApiService.generateContentStream(model, requestBody);
    }

    async listModels() {
        if (!this.antigravityApiService.isInitialized) {
            console.warn("antigravityApiService not initialized, attempting to re-initialize...");
            await this.antigravityApiService.initialize();
        }
        return this.antigravityApiService.listModels();
    }

    async refreshToken() {
        if (this.antigravityApiService.isExpiryDateNear() === true) {
            console.log(`[Antigravity] Expiry date is near, refreshing token...`);
            return this.antigravityApiService.initializeAuth(true);
        }
        return Promise.resolve();
    }

    /**
     * Get usage limits information
     * @returns {Promise<Object>} Usage limits information
     */
    async getUsageLimits() {
        if (!this.antigravityApiService.isInitialized) {
            console.warn("antigravityApiService not initialized, attempting to re-initialize...");
            await this.antigravityApiService.initialize();
        }
        return this.antigravityApiService.getUsageLimits();
    }
}

// OpenAI API service adapter
export class OpenAIApiServiceAdapter extends ApiServiceAdapter {
    constructor(config) {
        super();
        this.openAIApiService = new OpenAIApiService(config);
    }

    async generateContent(model, requestBody) {
        // The adapter now expects the requestBody to be in the native OpenAI format.
        // The conversion logic is handled upstream in the server.
        return this.openAIApiService.generateContent(model, requestBody);
    }

    async *generateContentStream(model, requestBody) {
        // The adapter now expects the requestBody to be in the native OpenAI format.
        const stream = this.openAIApiService.generateContentStream(model, requestBody);
        // The stream is yielded directly without conversion.
        yield* stream;
    }

    async listModels() {
        // The adapter now returns the native model list from the underlying service.
        return this.openAIApiService.listModels();
    }

    async refreshToken() {
        // OpenAI API keys are typically static and do not require refreshing.
        return Promise.resolve();
    }
}

// OpenAI Responses API service adapter
export class OpenAIResponsesApiServiceAdapter extends ApiServiceAdapter {
    constructor(config) {
        super();
        this.openAIResponsesApiService = new OpenAIResponsesApiService(config);
    }

    async generateContent(model, requestBody) {
        // The adapter expects the requestBody to be in the OpenAI Responses format.
        return this.openAIResponsesApiService.generateContent(model, requestBody);
    }

    async *generateContentStream(model, requestBody) {
        // The adapter expects the requestBody to be in the OpenAI Responses format.
        const stream = this.openAIResponsesApiService.generateContentStream(model, requestBody);
        yield* stream;
    }

    async listModels() {
        // The adapter returns the native model list from the underlying service.
        return this.openAIResponsesApiService.listModels();
    }

    async refreshToken() {
        // OpenAI API keys are typically static and do not require refreshing.
        return Promise.resolve();
    }
}

// Claude API service adapter
export class ClaudeApiServiceAdapter extends ApiServiceAdapter {
    constructor(config) {
        super();
        this.claudeApiService = new ClaudeApiService(config);
    }

    async generateContent(model, requestBody) {
        // The adapter now expects the requestBody to be in the native Claude format.
        return this.claudeApiService.generateContent(model, requestBody);
    }

    async *generateContentStream(model, requestBody) {
        // The adapter now expects the requestBody to be in the native Claude format.
        const stream = this.claudeApiService.generateContentStream(model, requestBody);
        yield* stream;
    }

    async listModels() {
        // The adapter now returns the native model list from the underlying service.
        return this.claudeApiService.listModels();
    }

    async refreshToken() {
        return Promise.resolve();
    }
}

// Claude Code API service adapter (via ai-sdk-provider-claude-code)
export class ClaudeCodeApiServiceAdapter extends ApiServiceAdapter {
    constructor(config) {
        super();
        this.claudeCodeApiService = new ClaudeCodeApiService(config);
    }

    async generateContent(model, requestBody) {
        return this.claudeCodeApiService.generateContent(model, requestBody);
    }

    async *generateContentStream(model, requestBody) {
        yield* this.claudeCodeApiService.generateContentStream(model, requestBody);
    }

    async listModels() {
        return this.claudeCodeApiService.listModels();
    }

    async refreshToken() {
        // Claude Code uses CLI auth, no token refresh needed
        return Promise.resolve();
    }
}

// Map for storing service adapter singletons
export const serviceInstances = {};

// Service adapter factory
export function getServiceAdapter(config) {
    console.log(`[Adapter] getServiceAdapter, provider: ${config.MODEL_PROVIDER}, uuid: ${config.uuid}`);
    const provider = config.MODEL_PROVIDER;
    const providerKey = config.uuid ? provider + config.uuid : provider;
    if (!serviceInstances[providerKey]) {
        switch (provider) {
            case MODEL_PROVIDER.OPENAI_CUSTOM:
                serviceInstances[providerKey] = new OpenAIApiServiceAdapter(config);
                break;
            case MODEL_PROVIDER.OPENAI_CUSTOM_RESPONSES:
                serviceInstances[providerKey] = new OpenAIResponsesApiServiceAdapter(config);
                break;
            case MODEL_PROVIDER.GEMINI_CLI:
                serviceInstances[providerKey] = new GeminiApiServiceAdapter(config);
                break;
            case MODEL_PROVIDER.ANTIGRAVITY:
                serviceInstances[providerKey] = new AntigravityApiServiceAdapter(config);
                break;
            case MODEL_PROVIDER.CLAUDE_CUSTOM:
                serviceInstances[providerKey] = new ClaudeApiServiceAdapter(config);
                break;
            case MODEL_PROVIDER.CLAUDE_CODE_CUSTOM:
                serviceInstances[providerKey] = new ClaudeCodeApiServiceAdapter(config);
                break;
            default:
                throw new Error(`Unsupported model provider: ${provider}`);
        }
    }
    return serviceInstances[providerKey];
}