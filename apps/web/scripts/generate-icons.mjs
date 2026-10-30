// Draws the PWA icons (a speech bubble on the app's warm primary colour) into public/.
// Run from apps/web with sharp available: node scripts/generate-icons.mjs
import { mkdirSync } from "node:fs";
import sharp from "sharp";

const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="#a0522d"/>
  <path d="M128 136h256a32 32 0 0 1 32 32v144a32 32 0 0 1-32 32H240l-72 64v-64h-40a32 32 0 0 1-32-32V168a32 32 0 0 1 32-32z" fill="#fff8ea"/>
  <circle cx="184" cy="240" r="22" fill="#a0522d"/>
  <circle cx="256" cy="240" r="22" fill="#a0522d"/>
  <circle cx="328" cy="240" r="22" fill="#a0522d"/>
</svg>`);

mkdirSync("public/icons", { recursive: true });
const targets = [
  ["public/favicon.png", 64],
  ["public/icons/apple-touch-icon.png", 180],
  ["public/icons/icon-192.png", 192],
  ["public/icons/icon-512.png", 512],
];
for (const [file, size] of targets) {
  await sharp(svg).resize(size, size).png().toFile(file);
}
