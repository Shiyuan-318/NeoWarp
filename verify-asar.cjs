const asar = require('@electron/asar');
const fs = require('fs');

const archive = 'dist/win-unpacked/resources/app.asar';
const entries = asar.listPackage(archive).map((p) => p.split('\\').join('/'));
const set = new Set(entries);

const want = [
  '/src-main/entrypoint.js',
  '/src-main/index.js',
  '/src-main/windows/onboarding.js',
  '/src-main/windows/editor.js',
  '/src-main/windows/desktop-settings.js',
  '/src-main/protocols.js',
  '/src-main/settings.js',
  '/src-preload/onboarding.js',
  '/src-preload/desktop-settings.js',
  '/src-renderer/onboarding/onboarding.html',
  '/src-renderer/desktop-settings/desktop-settings.html',
  '/dist-renderer-webpack/editor/gui/index.js',
  '/dist-renderer-webpack/editor/gui/gui.html',
  '/dist-renderer-webpack/editor/gui/migrate-helper.html',
  '/dist-extensions/index.html.br',
  '/dist-library-files',
  '/dist-extensions',
  '/package.json',
];

let failed = 0;
for (const w of want) {
  const ok = set.has(w);
  if (!ok) failed++;
  console.log(`${ok ? 'FOUND  ' : 'MISSING'} ${w}`);
}

const pkg = JSON.parse(asar.extractFile(archive, 'package.json').toString());
console.log('---');
console.log(`packaged version: ${pkg.version}`);
console.log(`packaged main:    ${pkg.main}`);
console.log(`total asar entries: ${entries.length}`);
console.log(`missing: ${failed}`);
process.exit(failed === 0 ? 0 : 1);
