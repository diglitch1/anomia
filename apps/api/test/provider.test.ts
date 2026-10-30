import { describe, expect, it } from "vitest";
import { createProvider } from "../src/gemma/index.js";
import { isAudioCapable, selectGemmaModel } from "../src/gemma/models.js";

const LISTED = ["models/gemini-2.5-flash", "models/gemma-4-31b-it", "models/gemma-4-e4b-it", "models/gemma-4-26b-a4b-it"];

describe("createProvider", () => {
  it("selects by name", () => {
    expect(createProvider("gemini").name).toBe("gemini");
    expect(createProvider("ollama").name).toBe("ollama");
  });

  it("rejects unknown providers", () => {
    expect(() => createProvider("openai")).toThrow(/Unknown GEMMA_PROVIDER/);
  });
});

describe("selectGemmaModel", () => {
  it("prefers E4B", () => {
    expect(selectGemmaModel(LISTED)).toBe("gemma-4-e4b-it");
  });

  it("uses a requested model that is listed", () => {
    expect(selectGemmaModel(LISTED, "gemma-4-31b-it")).toBe("gemma-4-31b-it");
  });

  it("rejects a requested model that is not listed", () => {
    expect(() => selectGemmaModel(LISTED, "gemma-4-e2b-it")).toThrow(/not in the models list/);
  });

  it("refuses a closed model even when it is listed", () => {
    expect(() => selectGemmaModel(LISTED, "gemini-2.5-flash")).toThrow(/must be a Gemma 4/);
  });

  it("falls back to the smallest listed Gemma 4 without E4B", () => {
    expect(selectGemmaModel(["models/gemma-4-31b-it", "models/gemma-4-26b-a4b-it"])).toBe("gemma-4-26b-a4b-it");
  });

  it("never picks a non-Gemma model", () => {
    expect(() => selectGemmaModel(["models/gemini-2.5-flash", "models/gemma-3-4b-it"])).toThrow(/No Gemma 4/);
  });
});

describe("isAudioCapable", () => {
  it("matches the model card", () => {
    expect(isAudioCapable("gemma-4-e4b-it")).toBe(true);
    expect(isAudioCapable("gemma-4-26b-a4b-it")).toBe(false);
    expect(isAudioCapable("gemma-4-31b-it")).toBe(false);
  });
});
