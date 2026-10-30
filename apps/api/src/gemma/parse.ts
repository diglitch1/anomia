import type { SuggestResult } from "./types.js";

const MAX_SENTENCE_CHARS = 300;
/** Neutral, fact-free options used only when the model returned fewer than three. */
const PADDING = ["Yes, please.", "No, thank you.", "I need help."];

function extractJson(raw: string): unknown {
  const unfenced = raw.replace(/```(?:json)?/gi, "").trim();
  const start = unfenced.indexOf("{");
  const end = unfenced.lastIndexOf("}");
  if (start === -1 || end <= start) return undefined;
  const candidate = unfenced.slice(start, end + 1);
  try {
    return JSON.parse(candidate);
  } catch {
    try {
      return JSON.parse(candidate.replace(/,\s*([}\]])/g, "$1"));
    } catch {
      return undefined;
    }
  }
}

function cleanSentence(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, MAX_SENTENCE_CHARS);
}

/** Always returns exactly three distinct non-empty sentences. */
export function normalizeSuggestions(values: unknown[]): [string, string, string] {
  const unique: string[] = [];
  for (const value of [...values, ...PADDING]) {
    const sentence = cleanSentence(value);
    if (sentence && !unique.some((seen) => seen.toLowerCase() === sentence.toLowerCase())) {
      unique.push(sentence);
    }
  }
  return [unique[0]!, unique[1]!, unique[2]!];
}

/** Parses model output as JSON, or returns null if it holds no suggestions. */
export function parseSuggestResult(raw: string): SuggestResult | null {
  const parsed = extractJson(raw) as Record<string, unknown> | undefined;
  if (!parsed || !Array.isArray(parsed.suggestions)) return null;
  if (!parsed.suggestions.some((value) => cleanSentence(value))) return null;
  const sceneTag = cleanSentence(parsed.sceneTag);
  return {
    transcriptGuess: cleanSentence(parsed.transcriptGuess),
    suggestions: normalizeSuggestions(parsed.suggestions),
    ...(sceneTag ? { sceneTag } : {}),
  };
}

/** Last resort for prose output: treats each non-structural line as a sentence. */
export function lineSplitFallback(raw: string): SuggestResult {
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").replace(/^["']|["'],?$/g, "").trim())
    .filter((line) => line && !/^[{}[\]`]/.test(line) && !/^"?\w+"?\s*:/.test(line));
  return { transcriptGuess: "", suggestions: normalizeSuggestions(lines) };
}

/** Parse, then one repair retry, then line-split fallback. */
export async function finalizeResult(
  raw: string,
  repair: (badOutput: string) => Promise<string>,
): Promise<SuggestResult> {
  const first = parseSuggestResult(raw);
  if (first) return first;
  try {
    const second = parseSuggestResult(await repair(raw));
    if (second) return second;
  } catch {
    // The original output is still usable by the fallback below.
  }
  return lineSplitFallback(raw);
}
