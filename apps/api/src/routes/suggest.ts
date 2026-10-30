import { Router } from "express";
import multer from "multer";
import { config } from "../config.js";
import { suggestWithFallback } from "../gemma/fallback.js";
import type { GemmaProvider, Profile } from "../gemma/types.js";
import { HttpError } from "../http.js";
import type { Integrations } from "../integrations.js";

const AUDIO_MIMES = new Set([
  "audio/webm",
  "video/webm",
  "audio/ogg",
  "audio/mp4",
  "video/mp4",
  "audio/wav",
  "audio/x-wav",
  "audio/wave",
]);
const MAX_RECENT_PICKS = 20;
const MAX_PICK_CHARS = 300;
const MAX_PROFILE_CHARS = 4_000;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxBodyBytes, files: 2, fieldSize: 64 * 1024 },
}).fields([
  { name: "audio", maxCount: 1 },
  { name: "image", maxCount: 1 },
]);

function parseProfile(raw: unknown): Profile {
  if (raw === undefined || raw === "") return {};
  if (typeof raw !== "string" || raw.length > MAX_PROFILE_CHARS) throw new HttpError(400, "Invalid profile");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new HttpError(400, "profile must be a JSON string");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new HttpError(400, "profile must be a JSON object");
  }
  return parsed as Profile;
}

function parseRecentPicks(raw: unknown): string[] {
  if (raw === undefined || raw === "") return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(String(raw));
  } catch {
    throw new HttpError(400, "recentPicks must be a JSON string array");
  }
  if (!Array.isArray(parsed) || !parsed.every((pick) => typeof pick === "string")) {
    throw new HttpError(400, "recentPicks must be a JSON string array");
  }
  return (parsed as string[]).slice(-MAX_RECENT_PICKS).map((pick) => pick.slice(0, MAX_PICK_CHARS));
}

export function createSuggestRouter(provider: GemmaProvider, integrations: Integrations): Router {
  const router = Router();

  router.post("/suggest", upload, async (req, res) => {
    const files = req.files as Record<string, Express.Multer.File[]> | undefined;
    const audio = files?.audio?.[0];
    const image = files?.image?.[0];
    if (!audio?.buffer.length) throw new HttpError(400, "audio is required");
    if ((audio.size ?? 0) + (image?.size ?? 0) > config.maxBodyBytes) throw new HttpError(413, "Upload too large");
    const audioMime = audio.mimetype.split(";")[0]!.trim().toLowerCase();
    if (!AUDIO_MIMES.has(audioMime)) throw new HttpError(400, "Unsupported audio type");

    const profile = parseProfile(req.body?.profile);
    const recentPicks = parseRecentPicks(req.body?.recentPicks);

    let prepared: { data: Buffer; mime: string } | undefined;
    if (image && integrations.prepareImage) {
      try {
        prepared = await integrations.prepareImage(image.buffer, image.mimetype);
      } catch (error) {
        if (integrations.ImageRejectedError && error instanceof integrations.ImageRejectedError) {
          throw new HttpError(400, error.message);
        }
        throw error;
      }
    }
    // Without the image module, raw photos are dropped rather than forwarded with their EXIF/GPS data.

    if (!provider.model) await provider.init().catch(() => {
      throw new HttpError(503, "Model is not available");
    });

    let outcome;
    try {
      outcome = await suggestWithFallback(
        provider,
        {
          audio: audio.buffer,
          audioMime,
          ...(prepared ? { image: prepared.data, imageMime: prepared.mime } : {}),
          profile,
          recentPicks,
        },
        integrations.transcribe,
      );
    } catch (error) {
      console.error(`gemma request failed: ${(error as { name?: string }).name ?? "Error"} ${(error as { status?: number }).status ?? ""}`);
      throw new HttpError(502, "Could not get suggestions");
    }

    res.setHeader("x-anomia-path", outcome.path);
    if (outcome.sttFailed) res.setHeader("x-anomia-stt", "failed");
    res.json(outcome.result);
  });

  return router;
}
