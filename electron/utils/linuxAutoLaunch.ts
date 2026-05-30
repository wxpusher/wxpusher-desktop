import { app } from 'electron';
import fs from 'fs';
import path from 'path';
import { logger } from './logger';
import { APP_ID } from './appId';

// Linux 开机自启:Electron 的 app.setLoginItemSettings / getLoginItemSettings 在 Linux 上是
// no-op(官方仅支持 macOS / Windows),因此这里按 freedesktop XDG Autostart 规范自行实现——
// 往 ~/.config/autostart/ 写入一个 .desktop 文件;主流桌面环境(GNOME / KDE / XFCE / Cinnamon /
// MATE / LXQt / Budgie 等)在用户登录时会自动执行该目录下的条目。
//
// 开关状态 = 该 .desktop 文件是否存在;开启 = 写入文件,关闭 = 删除文件。
// 这样 SettingsPage 的开关读到的就是磁盘上的真实状态,不会与实际行为脱节。

// 文件名采用 appId,符合 freedesktop 桌面文件命名惯例,且避免与其他应用冲突。
const AUTOSTART_FILE_NAME = `${APP_ID}.desktop`;
// .desktop 里展示给用户(部分 DE 的「启动应用」面板会列出)的名称,用面向用户的中文名。
const DESKTOP_ENTRY_NAME = 'WxPusher消息推送平台';
// 与 main.ts 的 wasLaunchedAtLogin() 约定一致:自启拉起时携带此参数供主进程识别。
const AUTO_LAUNCH_FLAG = '--opened-at-login';

function autostartDir(): string {
  // 优先遵循 XDG_CONFIG_HOME,未设置时回退到 ~/.config(规范默认值)。
  const configHome = process.env.XDG_CONFIG_HOME?.trim() || path.join(app.getPath('home'), '.config');
  return path.join(configHome, 'autostart');
}

function autostartFilePath(): string {
  return path.join(autostartDir(), AUTOSTART_FILE_NAME);
}

// 自启时实际要执行的可执行文件:
// - AppImage:运行时 process.execPath 指向临时挂载点(重启即失效),必须用 APPIMAGE
//   环境变量(指向 .AppImage 文件本身)。
// - deb / rpm / 直接运行:用 process.execPath。
function execTarget(): string {
  return process.env.APPIMAGE?.trim() || process.execPath;
}

// .desktop 的 Exec 字段需对含空格/特殊字符的路径转义:双引号包裹,并转义内部的双引号与反斜杠。
function quoteExec(p: string): string {
  return `"${p.replace(/(["\\])/g, '\\$1')}"`;
}

function buildDesktopEntry(): string {
  const exec = `${quoteExec(execTarget())} ${AUTO_LAUNCH_FLAG}`;
  return [
    '[Desktop Entry]',
    'Type=Application',
    `Name=${DESKTOP_ENTRY_NAME}`,
    `Exec=${exec}`,
    'Terminal=false',
    // GNOME 系据此判断该条目是否启用;缺省即生效,显式写 true 更稳妥。
    'X-GNOME-Autostart-enabled=true',
    '',
  ].join('\n');
}

/** 当前是否已开启 Linux 开机自启(以 autostart 目录下是否存在对应 .desktop 文件为准)。 */
export function isLinuxAutoLaunchEnabled(): boolean {
  try {
    return fs.existsSync(autostartFilePath());
  } catch (e) {
    logger.warn('读取 Linux 开机自启状态失败:', e);
    return false;
  }
}

/** 开启 / 关闭 Linux 开机自启。开启写入 .desktop,关闭删除之;失败仅记录日志,不抛出。 */
export function setLinuxAutoLaunch(enabled: boolean): void {
  const file = autostartFilePath();
  try {
    if (enabled) {
      fs.mkdirSync(autostartDir(), { recursive: true });
      fs.writeFileSync(file, buildDesktopEntry(), 'utf8');
      logger.info(`已写入 Linux 开机自启:${file}`);
    } else {
      fs.rmSync(file, { force: true });
      logger.info(`已移除 Linux 开机自启:${file}`);
    }
  } catch (e) {
    logger.error(`设置 Linux 开机自启失败 (enabled=${enabled}):`, e);
  }
}

/**
 * 若已开启自启,则用当前可执行路径重写 .desktop 文件。
 * 用于应用更新 / AppImage 文件被移动后,刷新 Exec 路径,避免「开关仍为开但实际拉不起来」。
 * 未开启时不做任何事(不会无中生有地创建文件)。
 */
export function refreshLinuxAutoLaunch(): void {
  if (process.platform !== 'linux') return;
  if (!isLinuxAutoLaunchEnabled()) return;
  setLinuxAutoLaunch(true);
}
