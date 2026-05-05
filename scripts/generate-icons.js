#!/usr/bin/env node
// Generate octopus-style extension icons at 16, 48, 128px
// Uses a simplified octopus silhouette (original design, not GitHub's Octocat)
// with a red notification badge in the top-right corner.

import sharp from 'sharp';
import { mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, '..', 'icons');
mkdirSync(outDir, { recursive: true });

// SVG octopus icon: round head + 6 curved tentacles + red badge
function makeSvg(size) {
  // Design at 128x128 viewBox, scale output
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 128 128">
  <!-- Octopus head -->
  <ellipse cx="64" cy="44" rx="30" ry="32" fill="#6e5494"/>
  <!-- Eyes -->
  <circle cx="54" cy="40" r="5" fill="white"/>
  <circle cx="74" cy="40" r="5" fill="white"/>
  <circle cx="55" cy="41" r="2.5" fill="#24292f"/>
  <circle cx="75" cy="41" r="2.5" fill="#24292f"/>
  <!-- Tentacles (6 curved paths) -->
  <g fill="none" stroke="#6e5494" stroke-width="7" stroke-linecap="round">
    <path d="M44,70 Q30,90 26,108"/>
    <path d="M52,74 Q44,95 38,112"/>
    <path d="M60,76 Q58,98 54,116"/>
    <path d="M68,76 Q70,98 74,116"/>
    <path d="M76,74 Q84,95 90,112"/>
    <path d="M84,70 Q98,90 102,108"/>
  </g>
  <!-- Red notification badge -->
  <circle cx="100" cy="18" r="14" fill="#e53935"/>
  <circle cx="100" cy="18" r="10" fill="#ff5252"/>
</svg>`;
}

const sizes = [16, 48, 128];

for (const size of sizes) {
  const svg = Buffer.from(makeSvg(size));
  await sharp(svg).resize(size, size).png().toFile(join(outDir, `icon${size}.png`));
  console.log(`✓ icon${size}.png`);
}
