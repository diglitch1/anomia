// Runs every fixture in fixtures/scenarios against a running API and prints the suggestions next to
// expected.md. Exits non-zero on any failed request. Usage: API_URL=http://localhost:8787 npm run test:suggest
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const API_URL = (process.env.API_URL ?? "http://localhost:8787").replace(/\/$/, "");
const SCENARIOS = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "scenarios");

async function runScenario(name: string): Promise<boolean> {
  const dir = join(SCENARIOS, name);
  console.log(`\n=== ${name} ===`);

  const audioPath = join(dir, "audio.webm");
  if (!existsSync(audioPath)) {
    console.error("FAILED: audio.webm is missing");
    return false;
  }

  const form = new FormData();
  form.set("audio", new Blob([readFileSync(audioPath)], { type: "audio/webm" }), "audio.webm");
  const imagePath = join(dir, "image.jpg");
  if (existsSync(imagePath)) {
    form.set("image", new Blob([readFileSync(imagePath)], { type: "image/jpeg" }), "image.jpg");
  }
  const profilePath = join(dir, "profile.json");
  if (existsSync(profilePath)) form.set("profile", readFileSync(profilePath, "utf8"));
  form.set("recentPicks", JSON.stringify([]));

  const start = performance.now();
  const response = await fetch(`${API_URL}/api/suggest`, { method: "POST", body: form });
  const ms = Math.round(performance.now() - start);
  const body = (await response.json()) as {
    error?: string;
    transcriptGuess?: string;
    sceneTag?: string;
    suggestions?: string[];
  };

  if (!response.ok || body.suggestions?.length !== 3) {
    console.error(`FAILED: HTTP ${response.status} ${body.error ?? "wrong number of suggestions"}`);
    return false;
  }

  const stt = response.headers.get("x-anomia-stt");
  console.log(`time: ${ms} ms${ms > 4000 ? " (over the 4 s target)" : ""}`);
  console.log(`path: ${response.headers.get("x-anomia-path")}${stt ? ` (speech-to-text ${stt})` : ""}`);
  console.log(`transcript: ${body.transcriptGuess}`);
  console.log(`scene: ${body.sceneTag ?? "-"}`);
  body.suggestions.forEach((sentence, index) => console.log(`  ${index + 1}. ${sentence}`));

  const expectedPath = join(dir, "expected.md");
  if (existsSync(expectedPath)) console.log(`\nexpected:\n${readFileSync(expectedPath, "utf8").trim()}`);
  return true;
}

const names = readdirSync(SCENARIOS, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

let failed = names.length === 0;
for (const name of names) {
  try {
    if (!(await runScenario(name))) failed = true;
  } catch (error) {
    console.error(`FAILED: ${(error as Error).message}`);
    failed = true;
  }
}
console.log(failed ? "\nSome scenarios failed." : `\nAll ${names.length} scenarios passed.`);
process.exit(failed ? 1 : 0);
