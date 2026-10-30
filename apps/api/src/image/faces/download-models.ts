/**
 * Downloads the face models into apps/api/models/faces (or FACE_MODELS_DIR) and verifies their checksums.
 *
 *   cd apps/api && npx tsx src/image/faces/download-models.ts
 *
 * The folder gets its own .gitignore so model weights are never committed.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { FACE_MODELS, modelsDir } from "./models.js";

async function main() {
  const dir = modelsDir();
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, ".gitignore"), "*\n");
  for (const model of Object.values(FACE_MODELS)) {
    const target = path.join(dir, model.file);
    const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
    if (existsSync(target) && sha(readFileSync(target)) === model.sha256) {
      console.log(`ok   ${model.file} (already present)`);
      continue;
    }
    const res = await fetch(model.url);
    if (!res.ok) throw new Error(`${model.file}: HTTP ${res.status}`);
    const bytes = Buffer.from(await res.arrayBuffer());
    if (sha(bytes) !== model.sha256) throw new Error(`${model.file}: checksum mismatch, refusing to install`);
    writeFileSync(`${target}.part`, bytes);
    renameSync(`${target}.part`, target);
    console.log(`got  ${model.file} (${(bytes.length / 1048576).toFixed(1)} MB, ${model.license})`);
  }
  console.log(`models in ${dir}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
