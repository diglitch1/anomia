import type { Router } from "express";

/**
 * The speech (src/voice) and image (src/image) modules are built on their own branches.
 * Loading them here lets the server run, and tell callers clearly, until they are merged.
 */
export interface Integrations {
  voiceRouter: Router | null;
  transcribe: (audio: Buffer, mime: string) => Promise<string>;
  /** Null until the image module is merged; images are then dropped, see routes/suggest.ts. */
  prepareImage: ((input: Buffer, mime: string) => Promise<{ data: Buffer; mime: string }>) | null;
  ImageRejectedError: (new (...args: never[]) => Error) | null;
}

async function loadOptional(relativePath: string): Promise<Record<string, unknown> | null> {
  const url = new URL(relativePath, import.meta.url);
  try {
    return (await import(url.href)) as Record<string, unknown>;
  } catch (error) {
    const { code, url: missingUrl } = error as { code?: string; url?: string };
    // Only "this module isn't here yet" is expected; a bug inside the module must still surface.
    if (code === "ERR_MODULE_NOT_FOUND" && (!missingUrl || missingUrl === url.href || missingUrl === url.href.replace(/\.js$/, ".ts"))) {
      console.warn(`${relativePath} is not present; its endpoints are disabled`);
      return null;
    }
    throw error;
  }
}

export async function loadIntegrations(): Promise<Integrations> {
  const voice = await loadOptional("./voice/index.js");
  const image = await loadOptional("./image/index.js");
  return {
    voiceRouter: voice ? (voice.createVoiceRouter as () => Router)() : null,
    transcribe: voice
      ? (voice.transcribe as Integrations["transcribe"])
      : async () => {
          throw new Error("Speech-to-text module is not available");
        },
    prepareImage: image ? (image.prepareImage as NonNullable<Integrations["prepareImage"]>) : null,
    ImageRejectedError: image ? (image.ImageRejectedError as NonNullable<Integrations["ImageRejectedError"]>) : null,
  };
}
