import { config } from "../config.js";
import { finalizeResult } from "./parse.js";
import { buildRepairText, buildUserText, SYSTEM_INSTRUCTION } from "./prompt.js";
import type { GemmaProvider, SuggestInput, SuggestResult } from "./types.js";

/**
 * Ollama's chat API takes text and images only, so speech always reaches this provider
 * as a transcript through the shared speech-to-text path.
 */
export class OllamaProvider implements GemmaProvider {
  readonly name = "ollama";
  readonly audioCapable = false;
  model: string | null = null;

  async init(): Promise<void> {
    const response = await fetch(`${config.ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(5_000) });
    if (!response.ok) throw new Error(`Ollama returned ${response.status}`);
    const { models } = (await response.json()) as { models?: { name: string }[] };
    if (!models?.some((model) => model.name === config.ollamaModel)) {
      throw new Error(`${config.ollamaModel} is not pulled; run: ollama pull ${config.ollamaModel}`);
    }
    this.model = config.ollamaModel;
    console.log(`gemma model: ${this.model}`);
  }

  async suggest(input: SuggestInput): Promise<SuggestResult> {
    const raw = await this.complete(buildUserText(input), input.image);
    return finalizeResult(raw, (bad) => this.complete(buildRepairText(bad)));
  }

  private async complete(text: string, image?: Buffer): Promise<string> {
    if (!this.model) throw new Error("Ollama provider is not initialised");
    const response = await fetch(`${config.ollamaUrl}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: AbortSignal.timeout(config.ollamaTimeoutMs),
      body: JSON.stringify({
        model: this.model,
        stream: false,
        think: false,
        format: "json",
        options: { temperature: 0.4 },
        messages: [
          { role: "system", content: SYSTEM_INSTRUCTION },
          { role: "user", content: text, ...(image ? { images: [image.toString("base64")] } : {}) },
        ],
      }),
    });
    if (!response.ok) {
      throw Object.assign(new Error("Ollama request failed"), { status: response.status });
    }
    const body = (await response.json()) as { message?: { content?: string } };
    return body.message?.content ?? "";
  }
}
