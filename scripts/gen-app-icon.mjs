// 从 scripts/icon-master.png（满幅方形原图）生成圆角（macOS 同款超椭圆 squircle）应用图标：
//   - resources/icon.ico  Windows 多尺寸图标
//   - resources/icon.png  Linux 应用图标
// macOS 自身会给图标加圆角，但 Windows / 多数 Linux 桌面都是原样显示位图，
// 所以圆角必须烘焙进图片本身。mac 用的 icon.icns 已是圆角，无需处理。
// 依赖系统已安装的 ImageMagick（magick 命令），不引入 npm 依赖。
// 运行：node scripts/gen-app-icon.mjs
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const resDir = join(__dirname, '..', 'resources');
const srcPng = join(__dirname, 'icon-master.png'); // 满幅方形母版（不随包分发）
const MAGICK = 'magick';

const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]; // Windows 按 DPI/场景自动选
const LINUX_SIZE = 512; // electron-builder 由此生成 deb/rpm 各尺寸
const N = 5;            // macOS 超椭圆轮廓 n≈5；满幅只磨四角，铃铛留白足够不会被裁
const SUPERSAMPLE = 4;  // 高倍渲染遮罩再缩小，获得平滑抗锯齿圆角

const tmp = mkdtempSync(join(tmpdir(), 'wxicon-'));

// 生成某尺寸下的超椭圆 alpha 遮罩（白=不透明，黑=透明）PGM 文件。
function makeSquircleMask(size) {
  const s = size * SUPERSAMPLE;
  const a = s / 2;
  const c = s / 2;
  const buf = Buffer.alloc(s * s, 0);
  for (let y = 0; y < s; y++) {
    const ny = Math.abs((y + 0.5 - c) / a);
    if (ny >= 1) continue;
    const dx = a * Math.pow(1 - Math.pow(ny, N), 1 / N);
    const x0 = Math.max(0, Math.round(c - dx));
    const x1 = Math.min(s, Math.round(c + dx));
    buf.fill(255, y * s + x0, y * s + x1);
  }
  const pgm = join(tmp, `mask-${size}.pgm`);
  writeFileSync(pgm, Buffer.concat([Buffer.from(`P5\n${s} ${s}\n255\n`), buf]));
  return { pgm, s };
}

// 缩放母版 -> 套超椭圆遮罩为 alpha -> 缩到目标尺寸，输出一张圆角 PNG。
function renderRounded(size, outPath) {
  const { pgm, s } = makeSquircleMask(size);
  execFileSync(MAGICK, [
    srcPng, '-resize', `${s}x${s}`,
    pgm, '-alpha', 'off', '-compose', 'CopyOpacity', '-composite',
    '-resize', `${size}x${size}`,
    outPath,
  ]);
  return outPath;
}

// Windows 多尺寸 ICO
const layerPngs = ICO_SIZES.map((size) => renderRounded(size, join(tmp, `layer-${size}.png`)));
execFileSync(MAGICK, [...layerPngs, join(resDir, 'icon.ico')]);

// Linux 应用图标
renderRounded(LINUX_SIZE, join(resDir, 'icon.png'));

rmSync(tmp, { recursive: true, force: true });
console.log(`已生成圆角图标：icon.ico（${ICO_SIZES.join(', ')}）+ icon.png（${LINUX_SIZE}）`);
