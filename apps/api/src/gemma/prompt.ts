import type { SuggestInput } from "./types.js";

export const SYSTEM_INSTRUCTION = `You help a person with aphasia say what they mean. You receive: (1) a short audio clip of their speech, which may be fragments, single words, wrong words, or sounds; (2) optionally a photo of what they see right now; (3) a profile of the person; (4) sentences they picked recently. Produce exactly three short, natural first-person sentences the person most likely wants to say right now. Rules: ground sentences in the audio first, then the scene, then the profile; prefer concrete everyday needs (drink, food, pain, temperature, bathroom, people, yes/no, feelings); keep each under 12 words; make the three options meaningfully different (for example a request, a complaint, a refusal); never add facts not supported by the input; if the audio is unintelligible, offer the three most likely sentences for the scene and profile. Output strict JSON: {"transcriptGuess": string, "sceneTag": string, "suggestions": [string, string, string]}.`;

export function buildUserText(input: SuggestInput): string {
  const lines = [
    `Profile: ${JSON.stringify(input.profile)}`,
    "Recent picks:",
    ...(input.recentPicks.length ? input.recentPicks.map((pick) => `- ${pick}`) : ["- (none)"]),
  ];
  if (input.transcript !== undefined) {
    lines.push(
      input.transcript.trim()
        ? `The audio clip was transcribed for you. Transcript of the speech: ${JSON.stringify(input.transcript)}`
        : "The audio clip was unintelligible.",
    );
  }
  return lines.join("\n");
}

export function buildRepairText(badOutput: string): string {
  return `Rewrite the following as strict JSON with exactly this shape and nothing else: {"transcriptGuess": string, "sceneTag": string, "suggestions": [string, string, string]}.\n\n${badOutput}`;
}
