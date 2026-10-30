export type Profile = Record<string, unknown>;

export interface SuggestInput {
  /** Omitted when the speech is sent as a transcript instead. */
  audio?: Buffer;
  audioMime?: string;
  /** Set on the speech-to-text path; an empty string means no intelligible speech. */
  transcript?: string;
  image?: Buffer;
  imageMime?: string;
  profile: Profile;
  recentPicks: string[];
}

export interface SuggestResult {
  transcriptGuess: string;
  suggestions: [string, string, string];
  sceneTag?: string;
}

export interface GemmaProvider {
  readonly name: "gemini" | "ollama";
  /** Exact model id, known once init() has succeeded. */
  readonly model: string | null;
  /** Whether the model can receive the audio clip directly. */
  readonly audioCapable: boolean;
  init(): Promise<void>;
  suggest(input: SuggestInput): Promise<SuggestResult>;
}
