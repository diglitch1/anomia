export interface ImageConfig {
  /** Longest side of the output in pixels. Smaller images are never upscaled. */
  maxSide: number;
  /** JPEG quality of the re-encoded output (1-100). */
  quality: number;
  /** Uploads larger than this are rejected before decoding. */
  maxInputBytes: number;
  /** Passed to sharp's limitInputPixels; guards memory on small servers. */
  maxInputPixels: number;
  /** Hard cap on the encoded output; quality steps down until it fits. */
  maxOutputBytes: number;
  /** How many images are decoded at the same time. Others wait in line. */
  maxConcurrent: number;
  /** sharp aborts a single image after this many seconds. */
  timeoutSeconds: number;
  /** Log one line per image with sizes and timing. Never logs image content. */
  log: boolean;
}

export const DEFAULT_CONFIG: Readonly<ImageConfig> = Object.freeze({
  maxSide: 768,
  quality: 80,
  maxInputBytes: 15 * 1024 * 1024,
  maxInputPixels: 50_000_000,
  maxOutputBytes: 400 * 1024,
  maxConcurrent: 2,
  timeoutSeconds: 10,
  log: true,
});

function intEnv(env: NodeJS.ProcessEnv, name: string, fallback: number, min: number, max: number): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}, got "${raw}"`);
  }
  return value;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ImageConfig {
  const d = DEFAULT_CONFIG;
  return {
    maxSide: intEnv(env, "IMAGE_MAX_SIDE", d.maxSide, 64, 4096),
    quality: intEnv(env, "IMAGE_JPEG_QUALITY", d.quality, 1, 100),
    maxInputBytes: intEnv(env, "IMAGE_MAX_INPUT_BYTES", d.maxInputBytes, 1024, 100 * 1024 * 1024),
    maxInputPixels: intEnv(env, "IMAGE_MAX_INPUT_PIXELS", d.maxInputPixels, 1, 268_402_689),
    maxOutputBytes: intEnv(env, "IMAGE_MAX_OUTPUT_BYTES", d.maxOutputBytes, 10 * 1024, 20 * 1024 * 1024),
    maxConcurrent: intEnv(env, "IMAGE_MAX_CONCURRENT", d.maxConcurrent, 1, 64),
    timeoutSeconds: intEnv(env, "IMAGE_TIMEOUT_SECONDS", d.timeoutSeconds, 1, 600),
    log: env.IMAGE_LOG !== "0",
  };
}
