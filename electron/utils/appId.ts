import { app } from 'electron';
import { execFileSync } from 'child_process';
import path from 'path';
import { logger } from './logger';

// 与 electron-builder.yml 的 appId 严格保持一致。
// 任何修改请同步两处，否则打包后的系统集成（通知设置深链、Windows 通知注册表查询、
// macOS LaunchAgent、Windows 自启等）会出现 ID 错位。
export const APP_ID = 'com.smjcco.wxpusher.desktop';

// macOS dev 下运行的是 Electron.app，其 Info.plist 中 CFBundleIdentifier = com.github.Electron
const DEV_MAC_BUNDLE_ID = 'com.github.Electron';

let cached: string | null = null;

/**
 * 获取当前进程在系统中注册的应用标识；随平台/运行模式自动适配，结果做内存缓存。
 *
 * - macOS: 动态读取当前运行 .app 的 CFBundleIdentifier
 *     dev  -> 'com.github.Electron'（运行 Electron.app）
 *     prod -> APP_ID
 * - Windows: 返回 app.setAppUserModelId 设置的 AUMID（dev/prod 均为 APP_ID）
 * - Linux: 返回 APP_ID
 *
 * 用于系统集成场景（通知设置深链、注册表查询等）——需要的是当前进程在系统侧的真实
 * 注册 ID，而不是打包时声明的 appId。声明身份的源头（如 setAppUserModelId）应直接
 * 使用 APP_ID 常量。
 *
 * 不能用 process.env.__CFBundleIdentifier——它是启动者（Terminal/iTerm）的 id，不可靠。
 */
export function getAppId(): string {
  if (cached) return cached;
  cached = compute();
  return cached;
}

function compute(): string {
  switch (process.platform) {
    case 'darwin':
      return readMacBundleId();
    case 'win32':
      // Electron 仅提供 setAppUserModelId（无对应 getter）；主进程启动时已
      // app.setAppUserModelId(APP_ID)，dev/prod 注册到系统的 AUMID 即此值。
      return APP_ID;
    default:
      return APP_ID;
  }
}

function readMacBundleId(): string {
  const fallback = app.isPackaged ? APP_ID : DEV_MAC_BUNDLE_ID;
  try {
    // process.resourcesPath = .../Xxx.app/Contents/Resources
    const infoBase = path.join(path.dirname(process.resourcesPath), 'Info');
    const id = execFileSync('defaults', ['read', infoBase, 'CFBundleIdentifier'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return id || fallback;
  } catch (e) {
    logger.warn('读取 macOS bundle id 失败,回退默认值:', e);
    return fallback;
  }
}
