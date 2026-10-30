import { describeError } from "../http.js";
import type { GemmaProvider, SuggestInput, SuggestResult } from "./types.js";

export type SuggestPath = "audio" | "stt";

export interface FallbackResult {
  result: SuggestResult;
  path: SuggestPath;
  /** Speech-to-text failed, so the suggestions rest on the scene and profile alone. */
  sttFailed: boolean;
}

/** 4xx responses that mean "this request's content was refused", unlike auth or quota errors. */
function isAudioRejection(error: unknown): boolean {
  const status = (error as { status?: number }).status;
  return status === 400 || status === 415 || status === 422;
}

/**
 * Sends audio directly when the model can take it. If the provider refuses it or hears nothing,
 * transcribes with speech-to-text and resends as text. Shared by both providers.
 */
export async function suggestWithFallback(
  provider: GemmaProvider,
  input: SuggestInput,
  transcribe: (audio: Buffer, mime: string) => Promise<string>,
): Promise<FallbackResult> {
  let direct: SuggestResult | undefined;
  if (provider.audioCapable) {
    try {
      direct = await provider.suggest(input);
      if (direct.transcriptGuess.trim()) return { result: direct, path: "audio", sttFailed: false };
    } catch (error) {
      if (!isAudioRejection(error)) throw error;
    }
  }

  let transcript = "";
  let sttFailed = false;
  try {
    transcript = input.audio ? await transcribe(input.audio, input.audioMime ?? "audio/webm") : "";
  } catch (error) {
    sttFailed = true;
    console.error(`speech-to-text failed: ${describeError(error)}`);
  }

  // Nothing new was learned, so a usable direct answer doesn't need a second model call.
  if (direct && !transcript.trim()) return { result: direct, path: "audio", sttFailed };

  const { audio: _audio, audioMime: _audioMime, ...withoutAudio } = input;
  const result = await provider.suggest({ ...withoutAudio, transcript });
  return {
    result: { ...result, transcriptGuess: transcript.trim() || result.transcriptGuess },
    path: "stt",
    sttFailed,
  };
}
