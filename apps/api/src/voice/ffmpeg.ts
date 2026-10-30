import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ffmpegStatic from "ffmpeg-static";
import { HttpError } from "../http.js";

function runFfmpeg(input: string, output: string): Promise<void> {
  // The bundled binary is missing when install scripts are blocked, so fall back to the system one.
  const bundled = ffmpegStatic as unknown as string | null;
  const binary = bundled && existsSync(bundled) ? bundled : "ffmpeg";
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn(binary, ["-y", "-i", input, "-vn", "-ac", "1", "-b:a", "128k", output], { stdio: "ignore" });
    ffmpeg.on("error", reject);
    ffmpeg.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new HttpError(400, "Could not read audio from that video"));
    });
  });
}

/** An mp4 cannot be read reliably from a pipe, so ffmpeg gets a private temp folder that is always deleted. */
export async function extractAudio(video: Buffer): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), "anomia-"));
  try {
    const input = join(dir, "input");
    const output = join(dir, "output.mp3");
    await writeFile(input, video);
    await runFfmpeg(input, output);
    return await readFile(output);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
