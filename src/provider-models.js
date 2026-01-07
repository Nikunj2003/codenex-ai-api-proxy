/**
 * List of models supported by each provider
 * Used for frontend UI to select unsupported models
 */

export const PROVIDER_MODELS = {
    'gemini-cli-oauth': [
        'gemini-2.5-flash',
        'gemini-2.5-flash-lite',
        'gemini-2.5-pro',
        'gemini-2.5-pro-preview-06-05',
        'gemini-2.5-flash-preview-09-2025',
        'gemini-3-pro-preview',
        'gemini-3-flash-preview'
    ],
    'gemini-antigravity': [
        'gemini-2.5-computer-use-preview-10-2025',
        'gemini-3-pro-image-preview',
        'gemini-3-pro-preview',
        'gemini-3-pro-low',
        'gemini-3-flash-preview',
        'gemini-2.5-flash',
        'gemini-2.5-pro',
        'gemini-2.5-flash-lite',
        'gemini-2.5-flash-thinking',
        'gpt-oss-120b-medium',
        'gemini-claude-sonnet-4-5',
        'gemini-claude-sonnet-4-5-thinking',
        'gemini-claude-opus-4-5-thinking'
    ],
    'claude-custom': [],
    'openai-custom': [],
    'openaiResponses-custom': [],
    'claudeCode-custom': [
        'opus',
        'sonnet',
        'haiku'
    ]
};

/**
 * Gets the list of models supported by the specified provider type
 * @param {string} providerType - Provider type
 * @returns {Array<string>} Model list
 */
export function getProviderModels(providerType) {
    return PROVIDER_MODELS[providerType] || [];
}

/**
 * Gets the model list for all providers
 * @returns {Object} Model mapping for all providers
 */
export function getAllProviderModels() {
    return PROVIDER_MODELS;
}