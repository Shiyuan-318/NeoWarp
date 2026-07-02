import sharp from 'sharp';
import toIco from 'to-ico';
import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const logoPath = resolve(__dirname, '..', 'Logo.png');
const icoOutputPath = resolve(__dirname, '..', 'build', 'icon.ico');
const iconPngPath = resolve(__dirname, '..', 'art', 'icon.png');
const largePngPath = resolve(__dirname, '..', 'build', '512x512.png');
const appxIconsDir = resolve(__dirname, '..', 'build', 'appx');

const sizes = [256, 128, 64, 48, 32, 16];

async function main() {
  console.log('Reading Logo.png...');
  const logoBuffer = readFileSync(logoPath);

  // Generate resized PNG buffers for ICO
  const pngBuffers = [];
  for (const size of sizes) {
    console.log(`Resizing to ${size}x${size}...`);
    const resized = await sharp(logoBuffer)
      .resize(size, size)
      .png()
      .toBuffer();
    pngBuffers.push(resized);
  }

  // Convert to ICO
  console.log('Generating icon.ico...');
  const icoBuffer = await toIco(pngBuffers);
  writeFileSync(icoOutputPath, icoBuffer);
  console.log(`icon.ico written to ${icoOutputPath}`);

  // Copy original PNG to art/icon.png
  console.log('Copying to art/icon.png...');
  writeFileSync(iconPngPath, logoBuffer);
  console.log(`icon.png written to ${iconPngPath}`);

  // Generate 512x512 PNG for build/
  console.log('Generating 512x512.png...');
  const largePng = await sharp(logoBuffer)
    .resize(512, 512)
    .png()
    .toBuffer();
  writeFileSync(largePngPath, largePng);
  console.log(`512x512.png written to ${largePngPath}`);

  // Generate AppX icons
  console.log('Generating AppX icons...');
  const appxIconConfigs = [
    { name: 'Square44x44Logo.png', size: 44 },
    { name: 'Square44x44Logo.targetsize-256.png', size: 256 },
    { name: 'Square44x44Logo.targetsize-44_altform-unplated.png', size: 44 },
    { name: 'Square150x150Logo.png', size: 150 },
    { name: 'Wide310x150Logo.png', size: { width: 310, height: 150 }, fit: 'contain' },
    { name: 'StoreLogo.png', size: 50 },
  ];

  for (const config of appxIconConfigs) {
    const sizeOpt = typeof config.size === 'object'
      ? { width: config.size.width, height: config.size.height, fit: config.fit || 'cover', background: { r: 0, g: 0, b: 0, alpha: 0 } }
      : { width: config.size, height: config.size };
    
    const appxPng = await sharp(logoBuffer)
      .resize(sizeOpt)
      .png()
      .toBuffer();
    writeFileSync(resolve(appxIconsDir, config.name), appxPng);
    console.log(`  ${config.name}`);
  }

  // Special: SmallTile.png (71x71)
  const smallTile = await sharp(logoBuffer)
    .resize(71, 71)
    .png()
    .toBuffer();
  writeFileSync(resolve(appxIconsDir, 'SmallTile.png'), smallTile);
  console.log('  SmallTile.png');

  console.log('\nAll icons generated successfully!');
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});