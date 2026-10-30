// Creates the fixture audio with a synthetic ElevenLabs voice. Never use a real person's recording.
// Usage from apps/api: npx tsx ../../scripts/generate-fixture-audio.ts
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURES = { "hot-tea": "wa... cup... hot... no", "open-window": "co... cold... win... shut" };

try {
  process.loadEnvFile(join(ROOT, "apps", "api", ".env"));
} catch {
  // Keys can also come from the environment.
}
const { ELEVENLABS_API_KEY: apiKey, DEFAULT_VOICE_ID: voiceId } = process.env;
if (!apiKey || !voiceId) throw new Error("ELEVENLABS_API_KEY and DEFAULT_VOICE_ID are required");

const require = createRequire(join(ROOT, "apps", "api", "package.json"));
const bundled = require("ffmpeg-static") as string | null;
const ffmpeg = bundled && existsSync(bundled) ? bundled : "ffmpeg";

// The scripts folder has no package.json, so tsx treats this file as CommonJS: no top-level await.
async function main(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "anomia-fixtures-"));
  try {
    for (const [scenario, text] of Object.entries(FIXTURES)) {
      const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "xi-api-key": apiKey },
        body: JSON.stringify({ text, model_id: "eleven_flash_v2_5" }),
      });
      if (!response.ok) throw new Error(`ElevenLabs returned ${response.status}`);
      const mp3 = join(dir, `${scenario}.mp3`);
      writeFileSync(mp3, Buffer.from(await response.arrayBuffer()));
      const output = join(ROOT, "fixtures", "scenarios", scenario, "audio.webm");
      const result = spawnSync(ffmpeg, ["-y", "-loglevel", "error", "-i", mp3, "-c:a", "libopus", "-b:a", "48k", output], { stdio: "inherit" });
      if (result.status !== 0) throw new Error(`ffmpeg failed for ${scenario}`);
      console.log(`wrote ${scenario}/audio.webm`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Failed");
  process.exit(1);
});
