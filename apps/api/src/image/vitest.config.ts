// TEMPORARY standalone harness, see package.json description.
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const here = dirname(fileURLToPath(import.meta.url));
// The tests live in apps/api/test, outside this folder's node_modules, so point bare imports here.
const pkgDir = (name: string) => resolve(here, "node_modules", name);

export default defineConfig({
  root: resolve(here, "../.."),
  cacheDir: resolve(here, "node_modules/.vite"),
  resolve: {
    alias: {
      sharp: pkgDir("sharp"),
      "exif-reader": pkgDir("exif-reader"),
    },
  },
  test: {
    include: ["test/image*.test.ts"],
  },
});
