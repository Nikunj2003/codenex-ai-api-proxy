/**
 * Converter Registration Module
 * Used to register all converters to the factory, avoiding circular dependency issues
 */

import { MODEL_PROTOCOL_PREFIX } from '../common.js';
import { ConverterFactory } from './ConverterFactory.js';
import { OpenAIConverter } from './strategies/OpenAIConverter.js';
import { OpenAIResponsesConverter } from './strategies/OpenAIResponsesConverter.js';
import { ClaudeConverter } from './strategies/ClaudeConverter.js';
import { GeminiConverter } from './strategies/GeminiConverter.js';
import { OllamaConverter } from './strategies/OllamaConverter.js';

/**
 * Register all converters to the factory
 * This function should be called once at application startup
 */
export function registerAllConverters() {
    ConverterFactory.registerConverter(MODEL_PROTOCOL_PREFIX.OPENAI, OpenAIConverter);
    ConverterFactory.registerConverter(MODEL_PROTOCOL_PREFIX.OPENAI_RESPONSES, OpenAIResponsesConverter);
    ConverterFactory.registerConverter(MODEL_PROTOCOL_PREFIX.CLAUDE, ClaudeConverter);
    ConverterFactory.registerConverter(MODEL_PROTOCOL_PREFIX.GEMINI, GeminiConverter);
    ConverterFactory.registerConverter(MODEL_PROTOCOL_PREFIX.OLLAMA, OllamaConverter);
}

// Automatically register all converters
registerAllConverters();