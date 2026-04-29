import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import pngToIco from "png-to-ico";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const desktopRoot = path.resolve(__dirname, "..");
const buildResourcesDir = path.join(desktopRoot, "buildResources");
const generatedDir = path.join(buildResourcesDir, "generated");
const iconSource = path.join(buildResourcesDir, "icon-source.svg");
const dmgSource = path.join(buildResourcesDir, "dmg-background-source.svg");
const iconsetDir = path.join(generatedDir, "icon.iconset");
const iconPng1024 = path.join(generatedDir, "icon-1024.png");
const iconIcns = path.join(buildResourcesDir, "icon.icns");
const iconIco = path.join(buildResourcesDir, "icon.ico");
const dmgBackgroundPng = path.join(buildResourcesDir, "dmg-background.png");

fs.rmSync(generatedDir, { recursive: true, force: true });
fs.mkdirSync(iconsetDir, { recursive: true });

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    ...options,
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function renderSvgToPng(sourceFile, outputFile, size) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "dataforge-icon-"));
  run("qlmanage", ["-t", "-s", String(size), "-o", tempDir, sourceFile], { stdio: "ignore" });
  const generatedFile = path.join(tempDir, `${path.basename(sourceFile)}.png`);
  fs.mkdirSync(path.dirname(outputFile), { recursive: true });
  fs.copyFileSync(generatedFile, outputFile);
  fs.rmSync(tempDir, { recursive: true, force: true });
}

function createResizedPng(sourceFile, outputFile, size) {
  fs.copyFileSync(sourceFile, outputFile);
  run("sips", ["-z", String(size), String(size), outputFile], { stdio: "ignore" });
}

renderSvgToPng(iconSource, iconPng1024, 1024);
renderSvgToPng(dmgSource, dmgBackgroundPng, 1280);
run("sips", ["-c", "800", "1280", dmgBackgroundPng], { stdio: "ignore" });

const iconSizes = [16, 32, 128, 256, 512];
for (const size of iconSizes) {
  createResizedPng(iconPng1024, path.join(iconsetDir, `icon_${size}x${size}.png`), size);
  createResizedPng(iconPng1024, path.join(iconsetDir, `icon_${size}x${size}@2x.png`), size * 2);
}

run("iconutil", ["-c", "icns", iconsetDir, "-o", iconIcns]);
const icoBuffer = await pngToIco([iconPng1024]);
fs.writeFileSync(iconIco, icoBuffer);
