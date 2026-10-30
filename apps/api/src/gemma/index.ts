import { GeminiProvider } from "./gemini.js";
import { OllamaProvider } from "./ollama.js";
import type { GemmaProvider } from "./types.js";

export function createProvider(name: string): GemmaProvider {
  switch (name) {
    case "gemini":
      return new GeminiProvider();
    case "ollama":
      return new OllamaProvider();
    default:
      throw new Error(`Unknown GEMMA_PROVIDER "${name}" (expected "gemini" or "ollama")`);
  }
}
