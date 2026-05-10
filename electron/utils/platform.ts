import os from 'os';
import path from 'path';
import fs from 'fs';

export type DesktopPlatform = 'desktop_mac' | 'desktop_win' | 'desktop_linux';

export function getDesktopPlatform(): DesktopPlatform {
  switch (process.platform) {
    case 'darwin':
      return 'desktop_mac';
    case 'win32':
      return 'desktop_win';
    default:
      return 'desktop_linux';
  }
}

export function getPlatformName(): string {
  switch (process.platform) {
    case 'darwin':
      return `macOS ${os.release()}`;
    case 'win32':
      return `Windows ${os.release()}`;
    default:
      return `Linux ${os.release()}`;
  }
}

export function getDeviceName(): string {
  return `${os.hostname()} (${getPlatformName()})`;
}

export function getAppVersion(): string {
  try {
    // dist-electron/ 的上一级就是 package.json 所在目录
    const pkgPath = path.join(__dirname, '..', 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    return pkg.version;
  } catch {
    return '1.0.0';
  }
}
