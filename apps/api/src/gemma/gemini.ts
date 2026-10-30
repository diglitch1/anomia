import { GoogleGenAI, ThinkingLevel, type Part } from "@google/genai";
import { config } from "../config.js";
import { isAudioCapable, selectGemmaModel } from "./models.js";
import { finalizeResult } from "./parse.js";
import { buildRepairText, buildUserText, SYSTEM_INSTRUCTION } from "./prompt.js";
import type { GemmaProvider, SuggestInput, SuggestResult } from "./types.js";

function inlinePart(data: Buffer, mimeType: string): Part {
  return { inlineData: { data: data.toString("base64"), mimeType } };
}

export class GeminiProvider implements GemmaProvider {
  readonly name = "gemini";
  model: string | null = null;
  private client: GoogleGenAI | null = null;
  private thinkingConfigSupported = true;

  get audioCapable(): boolean {
    return this.model !== null && isAudioCapable(this.model);
  }

  async init(): Promise<void> {
    if (!config.geminiApiKey) throw new Error("GEMINI_API_KEY is not set");
    const client = new GoogleGenAI({ apiKey: config.geminiApiKey });
    const listed: string[] = [];
    for await (const model of await client.models.list({ config: { pageSize: 100 } })) {
      if (model.name) listed.push(model.name);
    }
    this.model = selectGemmaModel(listed, config.gemmaModel);
    this.client = client;
    if (!/e4b/i.test(this.model)) {
      console.warn(`Gemma 4 E4B is not available on this API key; using ${this.model}`);
    }
    if (!this.audioCapable) {
      console.warn(`${this.model} has no audio encoder; all speech goes through speech-to-text`);
    }
    console.log(`gemma model: ${this.model}`);
  }

  async suggest(input: SuggestInput): Promise<SuggestResult> {
    const parts: Part[] = [{ text: buildUserText(input) }];
    if (input.audio && input.audioMime) parts.push(inlinePart(input.audio, input.audioMime));
    if (input.image && input.imageMime) parts.push(inlinePart(input.image, input.imageMime));
    const raw = await this.complete(parts);
    return finalizeResult(raw, (bad) => this.complete([{ text: buildRepairText(bad) }]));
  }

  private async complete(parts: Part[]): Promise<string> {
    try {
      return await this.generate(parts);
    } catch (error) {
      // Not every Gemma variant accepts a thinking level; remember that and retry without it.
      const { status, message } = error as { status?: number; message?: string };
      if (this.thinkingConfigSupported && status === 400 && /thinking/i.test(message ?? "")) {
        this.thinkingConfigSupported = false;
        return this.generate(parts);
      }
      throw error;
    }
  }

  private async generate(parts: Part[]): Promise<string> {
    if (!this.client || !this.model) throw new Error("Gemini provider is not initialised");
    const response = await this.client.models.generateContent({
      model: this.model,
      contents: [{ role: "user", parts }],
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        temperature: 0.4,
        abortSignal: AbortSignal.timeout(config.geminiTimeoutMs),
        ...(this.thinkingConfigSupported
          ? { thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL } }
          : {}),
      },
    });
    return response.text ?? "";
  }
}
