/** Preference order. E4B is the project default; the rest are other Gemma 4 sizes, smallest first. */
const PREFERENCE = [
  /^gemma-4-e4b.*-it/i,
  /^gemma-4-e2b.*-it/i,
  /^gemma-4-12b.*-it/i,
  /^gemma-4-26b.*-it/i,
  /^gemma-4-31b.*-it/i,
];

/** Only E2B, E4B and 12B have an audio encoder, per the Gemma 4 model card. */
export function isAudioCapable(modelId: string): boolean {
  return /^gemma-4-(e2b|e4b|12b)/i.test(modelId);
}

/**
 * Picks a model from the ids the API actually lists. Never returns anything but a Gemma 4 model,
 * so a closed model can't enter the suggestion path through configuration or list contents.
 */
export function selectGemmaModel(listed: string[], requested?: string): string {
  const ids = listed.map((id) => id.replace(/^models\//, ""));
  if (requested) {
    if (!/^gemma-4/i.test(requested)) {
      throw new Error(`GEMMA_MODEL must be a Gemma 4 model, got "${requested}"`);
    }
    if (!ids.includes(requested)) {
      throw new Error(`GEMMA_MODEL "${requested}" is not in the models list`);
    }
    return requested;
  }
  for (const pattern of PREFERENCE) {
    const match = ids.find((id) => pattern.test(id));
    if (match) return match;
  }
  throw new Error("No Gemma 4 model found in the models list");
}

/**
 * Other Gemma 4 models worth asking in parallel, because hosted Gemma can stall or fail per model.
 * Audio-capable models get none, since their requests carry audio the others would refuse.
 */
export function alternativeGemmaModels(listed: string[], selected: string): string[] {
  if (isAudioCapable(selected)) return [];
  const ids = listed.map((id) => id.replace(/^models\//, ""));
  return ids.filter((id) => id !== selected && !isAudioCapable(id) && PREFERENCE.some((p) => p.test(id)));
}
