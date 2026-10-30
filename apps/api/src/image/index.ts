import { performance } from "node:perf_hooks";
import sharp, { type OutputInfo, type SharpOptions } from "sharp";
import { loadConfig, type ImageConfig } from "./config.js";
import { ImageRejectedError } from "./errors.js";
import { Limiter } from "./limiter.js";

export { ImageRejectedError, type ImageRejectedCode } from "./errors.js";
export { DEFAULT_CONFIG, loadConfig, type ImageConfig } from "./config.js";

export interface PreparedImage {
  data: Buffer;
  mime: "image/jpeg";
}

// Each request decodes a fresh photo, so sharp's operation cache only costs memory.
sharp.cache(false);

const config = loadConfig();
const limiter = new Limiter(config.maxConcurrent);

const JPEG_MIMES = new Set(["image/jpeg", "image/jpg", "image/pjpeg"]);
const FALLBACK_QUALITIES = [60, 45, 30];

function hasJpegSignature(input: Buffer): boolean {
  return input.length >= 3 && input[0] === 0xff && input[1] === 0xd8 && input[2] === 0xff;
}

function isJpegMime(mime: string): boolean {
  return JPEG_MIMES.has(mime.split(";")[0]!.trim().toLowerCase());
}

const rejected = {
  empty: () => new ImageRejectedError("empty", "No photo was received. Please take the photo again."),
  tooLarge: () => new ImageRejectedError("too_large", "The photo is too large. Please take a smaller photo."),
  notJpeg: () => new ImageRejectedError("unsupported_type", "Only JPEG photos are supported."),
  unreadable: () => new ImageRejectedError("unreadable", "The photo could not be read. Please take it again."),
  timeout: () => new ImageRejectedError("timeout", "The photo took too long to process. Please try again."),
};

/**
 * Validates an uploaded JPEG, applies EXIF orientation, strips all metadata
 * (including GPS) and re-encodes it small enough to send to Gemma.
 * Nothing is written to disk and only sizes and timing are logged.
 *
 * `overrides` exists for tests and the benchmark; `maxConcurrent` is fixed at startup.
 */
export async function prepareImage(
  input: Buffer,
  mime: string,
  overrides?: Partial<ImageConfig>,
): Promise<PreparedImage> {
  const cfg = overrides ? { ...config, ...overrides } : config;

  if (!Buffer.isBuffer(input) || input.length === 0) throw rejected.empty();
  if (input.length > cfg.maxInputBytes) throw rejected.tooLarge();
  // Trust the bytes, not the client: both the declared type and the signature must say JPEG.
  if (typeof mime !== "string" || !isJpegMime(mime) || !hasJpegSignature(input)) throw rejected.notJpeg();

  const queuedAt = performance.now();
  return limiter.run(() => transform(input, cfg, queuedAt));
}

async function transform(input: Buffer, cfg: ImageConfig, queuedAt: number): Promise<PreparedImage> {
  const startedAt = performance.now();
  const sharpOptions: SharpOptions = { limitInputPixels: cfg.maxInputPixels, failOn: "truncated" };

  let width: number;
  let height: number;
  try {
    const meta = await sharp(input, sharpOptions).metadata();
    if (meta.format !== "jpeg" || !meta.width || !meta.height) throw rejected.notJpeg();
    width = meta.width;
    height = meta.height;
  } catch (err) {
    throw toRejection(err);
  }
  // metadata() only reads the header, so check the pixel budget before decoding.
  if (width * height > cfg.maxInputPixels) throw rejected.tooLarge();

  const encode = (quality: number) =>
    sharp(input, sharpOptions)
      .rotate() // apply EXIF orientation; sharp drops all metadata on output by default
      .resize({ width: cfg.maxSide, height: cfg.maxSide, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality, mozjpeg: false })
      .timeout({ seconds: cfg.timeoutSeconds })
      .toBuffer({ resolveWithObject: true });

  let quality = cfg.quality;
  let result: { data: Buffer; info: OutputInfo };
  try {
    result = await encode(quality);
    for (const fallback of FALLBACK_QUALITIES) {
      if (result.data.length <= cfg.maxOutputBytes || fallback >= quality) continue;
      quality = fallback;
      result = await encode(quality);
    }
  } catch (err) {
    throw toRejection(err);
  }
  if (result.data.length > cfg.maxOutputBytes) throw rejected.tooLarge();

  if (cfg.log) {
    const done = performance.now();
    console.info(
      `[image] in=${input.length}B ${width}x${height} out=${result.data.length}B ` +
        `${result.info.width}x${result.info.height} q=${quality} ` +
        `wait=${Math.round(startedAt - queuedAt)}ms took=${Math.round(done - startedAt)}ms`,
    );
  }
  return { data: result.data, mime: "image/jpeg" };
}

function toRejection(err: unknown): ImageRejectedError {
  if (err instanceof ImageRejectedError) return err;
  // sharp/libvips messages can echo input details, so map them to fixed user-safe text.
  const message = err instanceof Error ? err.message : "";
  if (/pixel limit/i.test(message)) return rejected.tooLarge();
  if (/timeout/i.test(message)) return rejected.timeout();
  return rejected.unreadable();
}
