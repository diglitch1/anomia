/**
 * Benchmarks prepareImage sizes/qualities against Gemma 4 through the Gemini API.
 *
 *   GEMINI_API_KEY=... npx tsx scripts/benchmark-image.ts [options]
 *
 * Options:
 *   --models a,b        Gemma 4 ids to test (default: every gemma-4 id the API lists)
 *   --sizes 512,768     longest-side limits to test (default 512,768,1024)
 *   --qualities 60,80   JPEG qualities to test (default 60,75,85)
 *   --photos <dir>      also run your own phone photos (*.jpg). Optional <dir>/expect.json:
 *                       { "kitchen.jpg": ["mug|cup", "table"] }. Nothing is copied or written.
 *   --delay-ms 2000     pause between model calls (rate limits)
 *   --local-only        skip the model, only measure prepareImage
 *
 * Open-weight models only: anything that is not a Gemma 4 id is refused.
 * Images stay in memory; only sizes, timings and the model's object list are printed.
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { performance } from "node:perf_hooks";
import type { GenerateContentResponse, GoogleGenAI as GoogleGenAIType } from "@google/genai";
import { prepareImage } from "../apps/api/src/image/index.js";

// Works whether tsx runs this file as CommonJS or ESM, and finds deps in apps/api.
const repoRoot = path.resolve(path.dirname(process.argv[1]!), "..");
const apiRequire = createRequire(path.join(repoRoot, "apps/api/src/image/index.ts"));
const sharp: typeof import("sharp").default = apiRequire("sharp");

const PROMPT = [
  "Look at this photo.",
  "Line 1: list up to 6 main physical objects you can clearly see, as lowercase nouns separated by commas.",
  "Line 2: 'scene: ' followed by a 2-5 word description of the place.",
  "If the photo is too dark or blurry to identify objects, answer only 'unclear'.",
  "Do not guess objects you cannot see.",
].join("\n");

type Args = {
  models?: string[];
  sizes: number[];
  qualities: number[];
  photos?: string;
  delayMs: number;
  localOnly: boolean;
};

function parseArgs(argv: string[]): Args {
  const args: Args = { sizes: [512, 768, 1024], qualities: [60, 75, 85], delayMs: 2000, localOnly: false };
  const nums = (v: string) => v.split(",").map((s) => Number(s.trim()));
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${flag} needs a value`);
      return v;
    };
    if (flag === "--models") args.models = value().split(",").map((s) => s.trim());
    else if (flag === "--sizes") args.sizes = nums(value());
    else if (flag === "--qualities") args.qualities = nums(value());
    else if (flag === "--photos") args.photos = value();
    else if (flag === "--delay-ms") args.delayMs = Number(value());
    else if (flag === "--local-only") args.localOnly = true;
    else throw new Error(`unknown option ${flag}`);
  }
  return args;
}

type Sample = {
  name: string;
  kind: "clean" | "dark" | "blur" | "photo";
  input: Buffer;
  /** Each group must be matched by at least one alternative, e.g. ["mug|cup", "table"]. */
  expect: string[];
};

const FIXTURE_EXPECT: Record<string, string[]> = {
  "hot-tea": ["mug|cup|tea|coffee", "table|desk|wood"],
  "open-window": ["window", "curtain|drape"],
};

/** Turns a 1280x960 fixture into something shaped like a 12 MP phone photo. */
async function phoneLike(fixture: Buffer, variant: "clean" | "dark" | "blur"): Promise<Buffer> {
  let img = sharp(fixture).resize(4032, 3024);
  if (variant === "dark") img = img.linear(0.18, 0);
  if (variant === "blur") img = img.blur(14);
  const base = await img.removeAlpha().raw().toBuffer({ resolveWithObject: true });
  // Sensor noise, stronger in the dark shot, so JPEG sizes resemble real photos.
  const sigma = variant === "dark" ? 10 : 4;
  const noise = await sharp({
    create: { width: 4032, height: 3024, channels: 3, background: { r: 0, g: 0, b: 0 }, noise: { type: "gaussian", mean: 128, sigma } },
  })
    .raw()
    .toBuffer();
  for (let i = 0; i < base.data.length; i++) base.data[i] = Math.max(0, Math.min(255, base.data[i]! + noise[i]! - 128));
  return sharp(base.data, { raw: base.info }).jpeg({ quality: 92 }).toBuffer();
}

async function loadSamples(photosDir?: string): Promise<Sample[]> {
  const samples: Sample[] = [];
  for (const [scenario, expect] of Object.entries(FIXTURE_EXPECT)) {
    const fixture = readFileSync(path.join(repoRoot, "fixtures/scenarios", scenario, "image.jpg"));
    for (const kind of ["clean", "dark", "blur"] as const) {
      samples.push({ name: `${scenario}/${kind}`, kind, input: await phoneLike(fixture, kind), expect });
    }
  }
  if (photosDir) {
    const expectPath = path.join(photosDir, "expect.json");
    const expectations: Record<string, string[]> = existsSync(expectPath) ? JSON.parse(readFileSync(expectPath, "utf8")) : {};
    for (const file of readdirSync(photosDir).filter((f) => /\.jpe?g$/i.test(f)).sort()) {
      samples.push({ name: `photo/${file}`, kind: "photo", input: readFileSync(path.join(photosDir, file)), expect: expectations[file] ?? [] });
    }
  }
  return samples;
}

function recognised(answer: string, expect: string[]): boolean | null {
  if (expect.length === 0) return null;
  const text = answer.toLowerCase();
  return expect.every((group) => group.split("|").some((word) => new RegExp(`\\b${word}`).test(text)));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (attempt >= 5 || (status !== 429 && status !== 503 && status !== 500)) throw err;
      const wait = 10_000 * attempt;
      console.warn(`  model returned ${status}, retrying in ${wait / 1000}s`);
      await sleep(wait);
    }
  }
}

async function listGemma4(ai: GoogleGenAIType): Promise<string[]> {
  const ids: string[] = [];
  const all: string[] = [];
  for await (const model of await ai.models.list({ config: { pageSize: 200 } })) {
    const id = (model.name ?? "").replace(/^models\//, "");
    all.push(id);
    if (/^gemma-4/i.test(id) && (model.supportedActions ?? ["generateContent"]).includes("generateContent")) ids.push(id);
  }
  console.log(`models listed: ${all.length}; gemma ids: ${all.filter((id) => id.startsWith("gemma")).join(", ") || "(none)"}`);
  return ids;
}

type Row = {
  model: string;
  sample: string;
  kind: Sample["kind"];
  size: number;
  quality: number;
  inBytes: number;
  outBytes: number;
  prepareMs: number;
  modelMs?: number;
  imageTokens?: number;
  ok?: boolean | null;
  answer?: string;
};

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const median = (xs: number[]) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
};

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const samples = await loadSamples(args.photos);
  console.log(`samples: ${samples.map((s) => `${s.name} (${(s.input.length / 1024).toFixed(0)} KB)`).join(", ")}`);

  let ai: GoogleGenAIType | undefined;
  let models: string[] = ["(local)"];
  if (!args.localOnly) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("GEMINI_API_KEY is not set (or pass --local-only)");
    const { GoogleGenAI } = apiRequire("@google/genai") as typeof import("@google/genai");
    ai = new GoogleGenAI({ apiKey });
    const available = await listGemma4(ai);
    console.log(`gemma 4 ids available: ${available.join(", ") || "(none)"}`);
    models = args.models ?? available;
    for (const id of models) {
      if (!/^gemma-4/i.test(id)) throw new Error(`${id} is not a Gemma 4 model; this benchmark only uses open-weight Gemma 4`);
      if (!available.includes(id)) throw new Error(`${id} was not in the models list`);
    }
    if (models.length === 0) throw new Error("no Gemma 4 model available for this key");
  }

  const rows: Row[] = [];
  for (const model of models) {
    if (ai) {
      // Text-only baseline, so the image's share of the latency is visible.
      const base: number[] = [];
      for (let i = 0; i < 3; i++) {
        const t = performance.now();
        await withRetry(() => ai!.models.generateContent({ model, contents: "Reply with the single word: ok", config: { temperature: 0, maxOutputTokens: 8 } }));
        base.push(performance.now() - t);
        await sleep(args.delayMs);
      }
      console.log(`\n${model}: text-only latency median ${median(base).toFixed(0)} ms (${base.map((b) => b.toFixed(0)).join(", ")})`);
    }

    for (const sample of samples) {
      // Degraded variants only need one quality per size; the clean ones get the full grid.
      const qualities = sample.kind === "dark" || sample.kind === "blur" ? [args.qualities[Math.floor(args.qualities.length / 2)]!] : args.qualities;
      for (const size of args.sizes) {
        for (const quality of qualities) {
          const t0 = performance.now();
          const prepared = await prepareImage(sample.input, "image/jpeg", { maxSide: size, quality, log: false });
          const row: Row = {
            model,
            sample: sample.name,
            kind: sample.kind,
            size,
            quality,
            inBytes: sample.input.length,
            outBytes: prepared.data.length,
            prepareMs: performance.now() - t0,
          };
          if (ai) {
            const t1 = performance.now();
            const res: GenerateContentResponse = await withRetry(() =>
              ai!.models.generateContent({
                model,
                contents: [
                  {
                    role: "user",
                    parts: [{ inlineData: { mimeType: prepared.mime, data: prepared.data.toString("base64") } }, { text: PROMPT }],
                  },
                ],
                config: { temperature: 0, maxOutputTokens: 256 },
              }),
            );
            row.modelMs = performance.now() - t1;
            row.imageTokens = res.usageMetadata?.promptTokensDetails?.find((d) => d.modality === "IMAGE")?.tokenCount;
            row.answer = (res.text ?? "").trim().replace(/\s+/g, " ");
            row.ok = recognised(row.answer, sample.expect);
            await sleep(args.delayMs);
          }
          rows.push(row);
          console.log(
            `${model} ${sample.name.padEnd(22)} ${String(size).padStart(4)}px q${quality} ` +
              `${(row.inBytes / 1024).toFixed(0).padStart(5)}KB -> ${(row.outBytes / 1024).toFixed(1).padStart(6)}KB ` +
              `prep ${row.prepareMs.toFixed(0).padStart(4)}ms` +
              (row.modelMs !== undefined ? ` model ${row.modelMs.toFixed(0).padStart(5)}ms img-tok ${row.imageTokens ?? "?"} ok=${row.ok}` : "") +
              (row.answer ? ` | ${row.answer.slice(0, 140)}` : ""),
          );
        }
      }
    }
  }

  console.log("\nsummary (clean fixtures; dark/blur/photo shown separately)");
  console.log("model | size | q | out KB (avg) | prepare ms (median) | model ms (median) | image tokens | recognised");
  const keys = [...new Set(rows.map((r) => `${r.model}|${r.size}|${r.quality}`))];
  for (const key of keys) {
    const [model, size, quality] = key.split("|");
    for (const group of [["clean"], ["dark", "blur"], ["photo"]] as const) {
      const rs = rows.filter((r) => `${r.model}|${r.size}|${r.quality}` === key && (group as readonly string[]).includes(r.kind));
      if (!rs.length) continue;
      const judged = rs.filter((r) => r.ok !== undefined && r.ok !== null);
      console.log(
        [
          model,
          size,
          quality + (group[0] === "clean" ? "" : ` (${group.join("+")})`),
          avg(rs.map((r) => r.outBytes / 1024)).toFixed(1),
          median(rs.map((r) => r.prepareMs)).toFixed(0),
          rs[0]!.modelMs !== undefined ? median(rs.map((r) => r.modelMs!)).toFixed(0) : "-",
          rs[0]!.imageTokens ?? "-",
          judged.length ? `${judged.filter((r) => r.ok).length}/${judged.length}` : "-",
        ].join(" | "),
      );
    }
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
