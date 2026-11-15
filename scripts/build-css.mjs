// Génère frontend/styles/tailwind.css à partir des classes utilisées dans frontend/index.html et frontend/app.js.
// Remplace le CDN « cdn.tailwindcss.com » (non destiné à la production). Lancer : npm run build:css (après npm install).
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
let TW;
try { TW = path.dirname(require.resolve('tailwindcss/package.json')); }
catch { console.error('tailwindcss est introuvable : lancez « npm install » (devDependency).'); process.exit(1); }

const { compile } = await import(
  pathToFileURL(path.join(TW, 'dist/lib.mjs')).href
);
const sources = ['frontend/index.html', 'frontend/app.js'].map((f) => fs.readFileSync(path.join(root, f), 'utf8')).join('\n');
const candidates = new Set(sources.match(/[^\s"'`<>=(){};,]+/g) || []);

const input = `
@layer theme, base, components, utilities;
@import "tailwindcss/theme.css" layer(theme);
@import "tailwindcss/preflight.css" layer(base);
@import "tailwindcss/utilities.css" layer(utilities);
@theme {
  --font-sans: 'Inter', ui-sans-serif, system-ui, sans-serif;
  --color-navy-800:#0b192c; --color-navy-900:#070f1e; --color-navy-950:#030712;
  --color-brand-blue:#1e64f0; --color-brand-gradientStart:#1d4ed8; --color-brand-gradientEnd:#0284c7;
}
@layer base { *,::before,::after{border-color:var(--color-gray-200);} }
`;
const files = { 'tailwindcss/theme.css': 'theme.css', 'tailwindcss/preflight.css': 'preflight.css', 'tailwindcss/utilities.css': 'utilities.css' };
const compiled = await compile(input, {
  base: TW,
  loadStylesheet: async (id) => {
    if (!files[id]) throw new Error(`Feuille de style inconnue : ${id}`);
    return { path: path.join(TW, files[id]), base: TW, content: fs.readFileSync(path.join(TW, files[id]), 'utf8') };
  }
});
const out = path.join(root, 'frontend/styles/tailwind.css');
fs.writeFileSync(out, compiled.build([...candidates]));
console.log(`${path.relative(root, out)} : ${fs.statSync(out).size} octets`);
