import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import express, { type NextFunction, type Request, type Response, type Router } from "express";
import multer from "multer";
import { HttpError } from "../http.js";
import { extractAudio } from "./ffmpeg.js";
import { LruCache } from "./lru.js";

const MAX_TEXT_LENGTH = 300;
const MAX_SAMPLE_BYTES = 30 * 1024 * 1024;
const VOICE_ID = /^[A-Za-z0-9]{10,40}$/;

let client: ElevenLabsClient | undefined;

/** Created on first use so the server still starts without a key. */
function elevenLabs(): ElevenLabsClient {
  const apiKey = process.env.ELEVENLABS_API_KEY?.trim();
  if (!apiKey) throw new HttpError(503, "ELEVENLABS_API_KEY is not set on the server");
  client ??= new ElevenLabsClient({ apiKey });
  return client;
}

function extensionFor(mime: string): string {
  if (mime.includes("mp4")) return "mp4";
  if (mime.includes("ogg")) return "ogg";
  if (mime.includes("wav")) return "wav";
  if (mime.includes("mpeg")) return "mp3";
  return "webm";
}

/** Provider errors can echo the request, so only the status is logged and returned. */
function providerError(where: string, error: unknown): Error {
  if (error instanceof HttpError) return error;
  const { name, statusCode } = (error ?? {}) as { name?: string; statusCode?: number };
  console.error(`${where} failed: ${name ?? "Error"} ${statusCode ?? ""}`.trim());
  return new HttpError(502, "The voice service failed");
}

export async function transcribe(audio: Buffer, mime: string): Promise<string> {
  const api = elevenLabs();
  const result = await api.speechToText.convert({
    modelId: process.env.ELEVENLABS_STT_MODEL?.trim() || "scribe_v2",
    file: { data: audio, filename: `audio.${extensionFor(mime)}`, contentType: mime },
    tagAudioEvents: false,
  });
  const { text, transcripts } = result as { text?: string; transcripts?: { text: string }[] };
  if (transcripts) return transcripts.map((t) => t.text).join(" ").trim();
  if (typeof text === "string") return text.trim();
  throw new Error("Unexpected transcription response");
}

function parseSpeak(body: unknown): { text: string; voiceId: string } {
  const { text, voiceId } = (body ?? {}) as { text?: unknown; voiceId?: unknown };
  if (typeof text !== "string" || !text.trim()) throw new HttpError(400, "text is required");
  const trimmed = text.trim();
  if (trimmed.length > MAX_TEXT_LENGTH) throw new HttpError(400, `text must be at most ${MAX_TEXT_LENGTH} characters`);
  if (typeof voiceId !== "string") throw new HttpError(400, "voiceId is required");
  if (voiceId === "default") {
    const fallback = process.env.DEFAULT_VOICE_ID?.trim();
    if (!fallback) throw new HttpError(503, "DEFAULT_VOICE_ID is not set on the server");
    return { text: trimmed, voiceId: fallback };
  }
  if (!VOICE_ID.test(voiceId)) throw new HttpError(400, "voiceId is invalid");
  return { text: trimmed, voiceId };
}

export function createVoiceRouter(): Router {
  const router = express.Router();
  const cache = new LruCache<Buffer>(50, 10 * 60 * 1000);
  const uploads = multer({ storage: multer.memoryStorage(), limits: { files: 5, fileSize: MAX_SAMPLE_BYTES } });

  // Audio is only ever produced here, for a sentence the user already confirmed on the device.
  router.post("/speak", express.json({ limit: "16kb" }), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { text, voiceId } = parseSpeak(req.body);
      const key = JSON.stringify([text, voiceId]);
      const cached = cache.get(key);
      if (cached) {
        res.type("audio/mpeg").send(cached);
        return;
      }
      const stream = await elevenLabs().textToSpeech.stream(voiceId, {
        text,
        modelId: process.env.ELEVENLABS_TTS_MODEL?.trim() || "eleven_flash_v2_5",
        outputFormat: "mp3_44100_128",
      });
      res.type("audio/mpeg");
      const chunks: Uint8Array[] = [];
      for await (const chunk of stream) {
        if (res.destroyed) return;
        chunks.push(chunk);
        res.write(chunk);
      }
      cache.set(key, Buffer.concat(chunks));
      res.end();
    } catch (error) {
      const failure = providerError("speak", error);
      if (res.headersSent) res.destroy();
      else next(failure);
    }
  });

  router.post("/voice/clone", uploads.array("samples", 5), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = (req.body ?? {}) as { consent?: unknown; name?: unknown };
      if (body.consent !== "true") throw new HttpError(400, "Consent is required to clone a voice");
      const name = typeof body.name === "string" ? body.name.trim().slice(0, 60) : "";
      if (!name) throw new HttpError(400, "name is required");
      const files = (req.files ?? []) as Express.Multer.File[];
      if (!files.length) throw new HttpError(400, "Add at least one audio or video sample");
      if (files.reduce((sum, f) => sum + f.size, 0) > MAX_SAMPLE_BYTES) throw new HttpError(400, "Samples must be at most 30 MB in total");
      if (files.some((f) => !/^(audio|video)\//.test(f.mimetype))) throw new HttpError(400, "Samples must be audio or video files");

      const api = elevenLabs();
      const samples = [];
      for (const [i, f] of files.entries()) {
        samples.push(
          f.mimetype.startsWith("video/")
            ? { data: await extractAudio(f.buffer), filename: `sample-${i}.mp3`, contentType: "audio/mpeg" }
            : { data: f.buffer, filename: `sample-${i}.${extensionFor(f.mimetype)}`, contentType: f.mimetype },
        );
      }
      const voice = await api.voices.ivc.create({
        name: `Anomia - ${name}`,
        description: "created with consent via Anomia",
        files: samples,
      });
      res.json({ voiceId: voice.voiceId });
    } catch (error) {
      next(providerError("voice clone", error));
    }
  });

  return router;
}
