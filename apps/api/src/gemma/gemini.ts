import { setTimeout } from "node:timers/promises";
import { GoogleGenAI, ThinkingLevel, type Part } from "@google/genai";
import { config } from "../config.js";
import { alternativeGemmaModels, isAudioCapable, selectGemmaModel } from "./models.js";
import { finalizeResult } from "./parse.js";
import { buildRepairText, buildUserText, SYSTEM_INSTRUCTION } from "./prompt.js";
import type { GemmaProvider, SuggestInput, SuggestResult } from "./types.js";

const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 500;
const ROUNDS = 3;
const ROUND_DELAY_MS = 12_000;

function inlinePart(data: Buffer, mimeType: string): Part {
  return { inlineData: { data: data.toString("base64"), mimeType } };
}

export class GeminiProvider implements GemmaProvider {
  readonly name = "gemini";
  model: string | null = null;
  private client: GoogleGenAI | null = null;
  private alternatives: string[] = [];
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
    this.alternatives = config.gemmaModel ? [] : alternativeGemmaModels(listed, this.model);
    this.client = client;
    if (!/e4b/i.test(this.model)) {
      console.warn(`Gemma 4 E4B is not available on this API key; using ${this.model}`);
    }
    if (!this.audioCapable) {
      console.warn(`${this.model} has no audio encoder; all speech goes through speech-to-text`);
    }
    console.log(`gemma model: ${this.model}`);
    if (this.alternatives.length) console.log(`gemma alternatives: ${this.alternatives.join(", ")}`);
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

  /**
   * Hosted Gemma answered in anything from 2 s to over 45 s in testing, so every candidate is asked
   * again each round without cancelling earlier requests, and the first answer wins.
   */
  private async generate(parts: Part[]): Promise<string> {
    if (!this.client || !this.model) throw new Error("Gemini provider is not initialised");
    const cancel = new AbortController();
    const signal = AbortSignal.any([cancel.signal, AbortSignal.timeout(config.geminiTimeoutMs)]);
    const candidates = [this.model, ...this.alternatives];
    const requests = Array.from({ length: ROUNDS }, (_, round) => round).flatMap((round) =>
      candidates.map(async (model) => {
        await setTimeout(round * ROUND_DELAY_MS, undefined, { signal });
        return this.generateOn(model, parts, signal);
      }),
    );
    try {
      return await Promise.any(requests);
    } catch (error) {
      throw error instanceof AggregateError ? error.errors[0] : error;
    } finally {
      cancel.abort();
    }
  }

  private async generateOn(model: string, parts: Part[], signal: AbortSignal): Promise<string> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        const response = await this.client!.models.generateContent({
          model,
          contents: [{ role: "user", parts }],
          config: {
            systemInstruction: SYSTEM_INSTRUCTION,
            temperature: 0.3,
            abortSignal: signal,
            ...(this.thinkingConfigSupported
              ? { thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL } }
              : {}),
          },
        });
        const text = response.text ?? "";
        if (!text.trim()) throw Object.assign(new Error("Empty model response"), { status: 502 });
        return text;
      } catch (error) {
        const status = (error as { status?: number }).status ?? 0;
        if (attempt >= MAX_ATTEMPTS || status < 500 || signal.aborted) throw error;
        await setTimeout(RETRY_DELAY_MS, undefined, { signal });
      }
    }
  }
}
