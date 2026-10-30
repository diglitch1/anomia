import { describe, expect, it, vi } from "vitest";
import { finalizeResult, lineSplitFallback, normalizeSuggestions, parseSuggestResult } from "../src/gemma/parse.js";

const VALID = '{"transcriptGuess":"cup hot no","sceneTag":"kitchen","suggestions":["The cup is too hot.","I want water.","No tea."]}';

describe("parseSuggestResult", () => {
  it("parses plain JSON", () => {
    expect(parseSuggestResult(VALID)).toEqual({
      transcriptGuess: "cup hot no",
      sceneTag: "kitchen",
      suggestions: ["The cup is too hot.", "I want water.", "No tea."],
    });
  });

  it("strips code fences and surrounding prose", () => {
    expect(parseSuggestResult(`Sure!\n\`\`\`json\n${VALID}\n\`\`\`\nDone.`)?.suggestions[0]).toBe("The cup is too hot.");
  });

  it("tolerates trailing commas", () => {
    expect(parseSuggestResult('{"suggestions":["A","B","C",],}')?.suggestions).toEqual(["A", "B", "C"]);
  });

  it("omits an empty sceneTag", () => {
    expect(parseSuggestResult('{"sceneTag":"","suggestions":["A","B","C"]}')).not.toHaveProperty("sceneTag");
  });

  it.each(["not json", "{}", '{"suggestions":"A"}', '{"suggestions":[]}', '{"suggestions":["",1]}'])(
    "returns null for %s",
    (raw) => {
      expect(parseSuggestResult(raw)).toBeNull();
    },
  );
});

describe("normalizeSuggestions", () => {
  it("truncates to three", () => {
    expect(normalizeSuggestions(["A", "B", "C", "D"])).toEqual(["A", "B", "C"]);
  });

  it("pads to three and removes duplicates", () => {
    const result = normalizeSuggestions(["Water.", "water.", " "]);
    expect(result).toHaveLength(3);
    expect(result[0]).toBe("Water.");
    expect(new Set(result.map((s) => s.toLowerCase())).size).toBe(3);
  });

  it("caps sentences at the /api/speak limit", () => {
    expect(normalizeSuggestions(["x".repeat(500)])[0]).toHaveLength(300);
  });
});

describe("lineSplitFallback", () => {
  it("cleans bullets and numbering", () => {
    expect(lineSplitFallback('1. I am cold.\n- Close the window.\n* "Leave it."').suggestions).toEqual([
      "I am cold.",
      "Close the window.",
      "Leave it.",
    ]);
  });

  it("skips JSON debris", () => {
    expect(lineSplitFallback('{\n"suggestions": [\nI am cold.\n]').suggestions[0]).toBe("I am cold.");
  });

  it("still returns three strings for empty output", () => {
    expect(lineSplitFallback("").suggestions).toHaveLength(3);
  });
});

describe("finalizeResult", () => {
  it("does not repair valid output", async () => {
    const repair = vi.fn();
    await finalizeResult(VALID, repair);
    expect(repair).not.toHaveBeenCalled();
  });

  it("repairs exactly once", async () => {
    const repair = vi.fn().mockResolvedValue(VALID);
    const result = await finalizeResult("I am cold.", repair);
    expect(repair).toHaveBeenCalledTimes(1);
    expect(result.suggestions[0]).toBe("The cup is too hot.");
  });

  it.each([
    ["returns junk", () => Promise.resolve("still junk")],
    ["throws", () => Promise.reject(new Error("down"))],
  ])("falls back to line splitting when repair %s", async (_name, repair) => {
    expect((await finalizeResult("I am cold.", repair)).suggestions[0]).toBe("I am cold.");
  });
});
