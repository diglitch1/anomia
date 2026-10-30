/**
 * Draws placeholder scene photos for the demo scenarios with sharp (simple SVG shapes).
 *
 *   cd apps/api && npx tsx ../../scripts/generate-fixture-images.ts
 *
 * Writes fixtures/scenarios/<scenario>/image.jpg. Only touches image.jpg; the other
 * files in those folders belong to other parts of the project.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

// Works whether tsx runs this file as CommonJS or ESM, and finds sharp in apps/api.
const repoRoot = path.resolve(path.dirname(process.argv[1]!), "..");
const apiRequire = createRequire(path.join(repoRoot, "apps/api/src/image/index.ts"));
const sharp: typeof import("sharp").default = apiRequire("sharp");

const WIDTH = 1280;
const HEIGHT = 960;

const svg = (body: string) =>
  Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">${body}</svg>`);

// A white mug of tea with steam on a wooden kitchen table.
const hotTea = svg(`
  <defs>
    <linearGradient id="wall" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e9dfcf"/><stop offset="1" stop-color="#d8cab3"/></linearGradient>
    <linearGradient id="wood" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#a0683a"/><stop offset="1" stop-color="#7a4a24"/></linearGradient>
    <linearGradient id="mug" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#d9d9d9"/><stop offset="0.35" stop-color="#ffffff"/><stop offset="1" stop-color="#bdbdbd"/></linearGradient>
    <radialGradient id="tea" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#b5651d"/><stop offset="1" stop-color="#6b3410"/></radialGradient>
  </defs>
  <rect width="1280" height="560" fill="url(#wall)"/>
  <rect y="540" width="1280" height="420" fill="url(#wood)"/>
  <g stroke="#6a3d1c" stroke-width="3" opacity="0.5">
    <line x1="0" y1="640" x2="1280" y2="625"/><line x1="0" y1="760" x2="1280" y2="770"/><line x1="0" y1="880" x2="1280" y2="868"/>
  </g>
  <ellipse cx="640" cy="790" rx="230" ry="38" fill="#000" opacity="0.25"/>
  <path d="M780 520 C900 520 900 700 775 700" fill="none" stroke="#cfcfcf" stroke-width="34"/>
  <path d="M780 520 C900 520 900 700 775 700" fill="none" stroke="#f2f2f2" stroke-width="18"/>
  <path d="M480 420 L800 420 L780 760 Q640 800 500 760 Z" fill="url(#mug)" stroke="#9e9e9e" stroke-width="4"/>
  <ellipse cx="640" cy="420" rx="160" ry="34" fill="#f5f5f5" stroke="#9e9e9e" stroke-width="4"/>
  <ellipse cx="640" cy="426" rx="140" ry="24" fill="url(#tea)"/>
  <rect x="690" y="430" width="6" height="140" fill="#eeeeee"/>
  <rect x="660" y="560" width="66" height="80" rx="6" fill="#4f7d3a"/>
  <g fill="none" stroke="#ffffff" stroke-width="12" stroke-linecap="round" opacity="0.75">
    <path d="M590 380 C560 330 620 300 590 240 C565 195 610 170 595 130"/>
    <path d="M650 370 C620 320 680 290 650 230 C625 185 670 160 655 120"/>
    <path d="M710 380 C680 330 740 300 710 240 C685 195 730 170 715 130"/>
  </g>
`);

// A room wall with a wide-open casement window, sky outside and a curtain.
const openWindow = svg(`
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5aa0e6"/><stop offset="1" stop-color="#bfe0ff"/></linearGradient>
    <linearGradient id="curtain" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#7d3c98"/><stop offset="0.5" stop-color="#a569bd"/><stop offset="1" stop-color="#6c3483"/></linearGradient>
  </defs>
  <rect width="1280" height="960" fill="#efe6d8"/>
  <rect y="860" width="1280" height="100" fill="#8d6e63"/>
  <rect x="360" y="140" width="560" height="560" fill="url(#sky)"/>
  <g fill="#ffffff" opacity="0.9">
    <ellipse cx="500" cy="250" rx="90" ry="34"/><ellipse cx="560" cy="230" rx="70" ry="40"/>
    <ellipse cx="760" cy="330" rx="80" ry="28"/><ellipse cx="810" cy="315" rx="55" ry="32"/>
  </g>
  <path d="M360 560 Q470 470 560 540 Q650 480 760 545 Q840 500 920 550 L920 700 L360 700 Z" fill="#4caf50"/>
  <path d="M360 620 Q520 560 700 630 Q820 600 920 640 L920 700 L360 700 Z" fill="#2e7d32"/>
  <rect x="340" y="120" width="600" height="600" fill="none" stroke="#fafafa" stroke-width="40"/>
  <rect x="340" y="700" width="600" height="40" fill="#e0e0e0"/>
  <polygon points="360,140 180,90 180,780 360,700" fill="#ffffff" stroke="#bdbdbd" stroke-width="6"/>
  <polygon points="200,130 340,165 340,675 200,730" fill="#cfe8ff" opacity="0.7"/>
  <polygon points="920,140 1100,90 1100,780 920,700" fill="#ffffff" stroke="#bdbdbd" stroke-width="6"/>
  <polygon points="940,165 1080,130 1080,730 940,675" fill="#cfe8ff" opacity="0.7"/>
  <rect x="1060" y="420" width="16" height="60" rx="6" fill="#9e9e9e"/>
  <rect x="80" y="60" width="1120" height="18" rx="9" fill="#5d4037"/>
  <path d="M90 70 L240 70 Q200 400 250 860 L90 860 Z" fill="url(#curtain)"/>
  <path d="M1190 70 L1060 70 Q1110 400 1050 860 L1190 860 Z" fill="url(#curtain)"/>
  <rect x="560" y="660" width="70" height="40" fill="#c0703a"/>
  <path d="M595 660 C560 600 570 580 595 620 C610 570 640 590 595 660" fill="#388e3c"/>
`);

const scenes: Record<string, Buffer> = {
  "hot-tea": hotTea,
  "open-window": openWindow,
};

async function main() {
  for (const [scenario, image] of Object.entries(scenes)) {
    const dir = path.join(repoRoot, "fixtures/scenarios", scenario);
    mkdirSync(dir, { recursive: true });
    const jpeg = await sharp(image).jpeg({ quality: 88 }).toBuffer();
    const out = path.join(dir, "image.jpg");
    writeFileSync(out, jpeg);
    console.log(`wrote ${path.relative(repoRoot, out)} (${jpeg.length} bytes, ${WIDTH}x${HEIGHT})`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
