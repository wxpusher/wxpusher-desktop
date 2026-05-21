// 从 resources/tray-icon.svg 生成各平台系统托盘图标资源。
// 依赖系统已安装的 ImageMagick（magick 命令），不引入 npm 依赖。
// 运行：node scripts/gen-tray-icons.mjs
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const resDir = join(__dirname, '..', 'resources');
const svgPath = join(resDir, 'tray-icon.svg');

// 品牌紫（取自 icon.png 背景色），黑色用于 macOS 模板图标
const PURPLE = '#A100A1';
const BLACK = '#000000';
const MAGICK = 'magick';

const svgSource = readFileSync(svgPath, 'utf8');
const tmp = mkdtempSync(join(tmpdir(), 'wxtray-'));

// 以指定颜色把 SVG 光栅化为透明背景的 PNG。
// 先在高 density 下渲染再缩放，获得平滑抗锯齿。
function renderPng(color, size, outPath) {
  const svg = svgSource.replace(/currentColor/g, color);
  const svgFile = join(tmp, `src-${size}-${color.slice(1)}.svg`);
  writeFileSync(svgFile, svg);
  execFileSync(MAGICK, [
    '-background', 'none',
    '-density', '1000',
    svgFile,
    '-resize', `${size}x${size}`,
    outPath,
  ]);
}

// macOS 模板图标（纯黑 + 透明，菜单栏自动反色）
renderPng(BLACK, 18, join(resDir, 'trayTemplate.png'));
renderPng(BLACK, 36, join(resDir, 'trayTemplate@2x.png'));

// Linux 托盘图标（品牌紫）
renderPng(PURPLE, 24, join(resDir, 'tray.png'));
renderPng(PURPLE, 48, join(resDir, 'tray@2x.png'));

// Windows 多尺寸 ICO（品牌紫，按 DPI 自动选尺寸）
const icoPngs = [16, 20, 24, 32].map((s) => {
  const p = join(tmp, `ico-${s}.png`);
  renderPng(PURPLE, s, p);
  return p;
});
execFileSync(MAGICK, [...icoPngs, join(resDir, 'tray.ico')]);

rmSync(tmp, { recursive: true, force: true });
console.log('托盘图标已生成：trayTemplate.png / trayTemplate@2x.png / tray.png / tray@2x.png / tray.ico');
