// Flattens the static client build into dist/ and generates an app-shell service worker.
import { cpSync, rmSync, existsSync } from "node:fs";
import { generateSW } from "workbox-build";

if (existsSync("dist/client")) {
  cpSync("dist/client", "dist/.static", { recursive: true });
  rmSync("dist/client", { recursive: true, force: true });
  rmSync("dist/server", { recursive: true, force: true });
  cpSync("dist/.static", "dist", { recursive: true });
  rmSync("dist/.static", { recursive: true, force: true });
}

const { count } = await generateSW({
  globDirectory: "dist",
  globPatterns: ["**/*.{js,css,html,png,ico,webmanifest,woff2}"],
  globIgnores: ["audio/**"],
  swDest: "dist/sw.js",
  skipWaiting: true,
  clientsClaim: true,
  cleanupOutdatedCaches: true,
  navigateFallback: "/index.html",
  navigateFallbackDenylist: [/^\/api\//],
  // Never cache API calls; only the precached app shell is served from cache.
  runtimeCaching: [],
});
console.log(`Service worker: precached ${count} files`);
