// @lovable.dev/vite-tanstack-config already includes tanstackStart, viteReact, tailwindcss,
// tsConfigPaths, VITE_* env injection and the @ alias — do NOT add them manually.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  // Static client-only site: no Nitro server output.
  nitro: false,
  tanstackStart: {
    spa: { enabled: true, prerender: { outputPath: "/index.html" } },
  },
});
