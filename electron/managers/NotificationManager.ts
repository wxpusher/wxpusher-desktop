import { Notification, NotificationConstructorOptions, shell } from 'electron';
import { execFileSync } from 'child_process';
import path from 'path';
import { WindowManager } from './WindowManager';
import { PreferencesManager } from './PreferencesManager';
import { logger } from '../utils/logger';

type NotificationMode = 'normal' | 'silent' | 'quiet';

// 未授权时的引导方式:
//  none     - 已授权,无需引导
//  settings - 能打开系统通知设置页引导用户开启(macOS / Windows)
//  manual   - 无法打开设置页,只能文案引导(Linux)
// 注:三端均无可编程申请通知权限的 API(Electron 的 notification.show()
//     实测不会触发 macOS 授权弹窗,node-mac-permissions 也无 notifications 申请方法),
//     故没有"直接申请"这一档。
export interface NotifyPermissionState {
  supported: boolean;
  granted: boolean;
  guide: 'none' | 'settings' | 'manual';
}

// 应用标识,与 electron-builder 的 appId 一致;
// 同时用作 Windows 通知归属的 AUMID 与 macOS 深链通知设置的 bundleId 回退值。
const APP_BUNDLE_ID = 'com.smjcco.wxpusher.desktop';

// macOS 通知授权状态查询依赖原生模块,仅在 darwin 懒加载;非 darwin 或加载失败不致命。
let macPermissions: { getAuthStatus(type: string): string } | null = null;
if (process.platform === 'darwin') {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    macPermissions = require('node-mac-permissions');
  } catch (e) {
    logger.warn('node-mac-permissions 加载失败,macOS 通知权限检测降级:', e);
  }
}

class NotificationManagerClass {
  private notificationMode: NotificationMode = 'normal';
  private macBundleId: string | null = null;

  init(): void {
    this.notificationMode = PreferencesManager.get('notificationMode');
  }

  showNotification(options: { title: string; body: string; messageId: number }): void {
    logger.info(`showNotification: mode=${this.notificationMode} title=${options.title}`);

    // 静默通知:不弹系统横幅、不出声;消息列表已由 WsManager 的 ws:new-message 更新
    if (this.notificationMode === 'quiet') {
      logger.info('静默通知:跳过系统弹窗');
      return;
    }

    const notificationOptions: NotificationConstructorOptions = {
      title: options.title,
      body: options.body,
      silent: this.notificationMode === 'silent',
    };

    try {
      const notification = new Notification(notificationOptions);
      notification.on('click', () => {
        WindowManager.showMainWindow();
        WindowManager.sendToRenderer('notification:click', options.messageId);
      });
      notification.show();
    } catch (e) {
      logger.warn('发送通知失败:', e);
    }
  }

  // 检测系统通知授权状态。各平台机制不同:
  // - macOS:原生模块查询 UNUserNotificationCenter 授权态;
  // - Windows:读注册表里的全局 + 应用级 toast 开关;
  // - Linux:以通知守护进程是否可用为准(无 per-app 权限概念)。
  async checkPermission(): Promise<NotifyPermissionState> {
    const supported = Notification.isSupported();
    if (!supported) return { supported: false, granted: false, guide: 'manual' };

    if (process.platform === 'darwin') {
      if (!macPermissions) {
        // 原生模块不可用时不误报为未授权
        return { supported: true, granted: true, guide: 'none' };
      }
      try {
        const status = macPermissions.getAuthStatus('notifications');
        logger.info(`macOS 通知授权状态: ${status}`);
        // authorized / provisional / limited 视为已授权;
        // not determined / denied / restricted 均无法编程申请,统一引导到系统设置。
        if (status === 'authorized' || status === 'provisional' || status === 'limited') {
          return { supported: true, granted: true, guide: 'none' };
        }
        return { supported: true, granted: false, guide: 'settings' };
      } catch (e) {
        logger.warn('查询 macOS 通知权限失败:', e);
        return { supported: true, granted: true, guide: 'none' };
      }
    }

    if (process.platform === 'win32') {
      const enabled = this.isWindowsNotificationEnabled();
      return enabled
        ? { supported: true, granted: true, guide: 'none' }
        : { supported: true, granted: false, guide: 'settings' };
    }

    // Linux:isSupported() 已反映通知守护进程是否可用
    return { supported: true, granted: true, guide: 'none' };
  }

  // 读注册表 DWORD;键/值不存在或查询失败返回 null
  private readRegistryDword(keyPath: string, valueName: string): number | null {
    try {
      const out = execFileSync('reg', ['query', keyPath, '/v', valueName], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      const m = out.match(new RegExp(`${valueName}\\s+REG_DWORD\\s+0x([0-9a-fA-F]+)`));
      return m ? parseInt(m[1], 16) : null;
    } catch {
      return null;
    }
  }

  // Windows:全局 toast 开关 + 应用级开关均未被显式关闭才算启用。
  // 键/值不存在视为默认开启;任何查询异常一律按"已启用"处理,避免误报。
  private isWindowsNotificationEnabled(): boolean {
    const globalToast = this.readRegistryDword(
      'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\PushNotifications',
      'ToastEnabled'
    );
    if (globalToast === 0) return false;

    const appEnabled = this.readRegistryDword(
      `HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Notifications\\Settings\\${APP_BUNDLE_ID}`,
      'Enabled'
    );
    if (appEnabled === 0) return false;

    return true;
  }

  // 动态获取当前运行 .app 的 bundle id(dev 下为 Electron,打包后为本应用)。
  // 不能用 process.env.__CFBundleIdentifier——它是启动者(如 Terminal)的 id,不可靠。
  private getMacBundleId(): string {
    if (this.macBundleId) return this.macBundleId;
    try {
      // process.resourcesPath = .../Xxx.app/Contents/Resources
      const infoBase = path.join(path.dirname(process.resourcesPath), 'Info');
      const id = execFileSync('defaults', ['read', infoBase, 'CFBundleIdentifier'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      this.macBundleId = id || APP_BUNDLE_ID;
    } catch (e) {
      logger.warn('读取 macOS bundle id 失败,回退默认值:', e);
      this.macBundleId = APP_BUNDLE_ID;
    }
    return this.macBundleId;
  }

  // 打开系统通知设置页。返回是否存在可用的打开方式(Linux 无统一入口)。
  openNotificationSettings(): boolean {
    switch (process.platform) {
      case 'darwin': {
        // macOS 13+ 为新版「系统设置」,旧的 com.apple.preference.notifications 已失效;
        // 需用新的扩展标识。低版本仍用旧 prefPane。
        const major = parseInt(process.getSystemVersion().split('.')[0], 10) || 0;
        const base =
          major >= 13
            ? 'x-apple.systempreferences:com.apple.Notifications-Settings.extension'
            : 'x-apple.systempreferences:com.apple.preference.notifications';
        // 追加 ?id=<bundleId> 直接定位到本应用的通知设置项
        const url = `${base}?id=${this.getMacBundleId()}`;
        shell.openExternal(url).catch((e) => logger.warn('打开通知设置失败:', e));
        return true;
      }
      case 'win32':
        shell.openExternal('ms-settings:notifications').catch((e) =>
          logger.warn('打开通知设置失败:', e)
        );
        return true;
      default:
        return false;
    }
  }

  setMode(mode: NotificationMode): void {
    this.notificationMode = mode;
    PreferencesManager.set('notificationMode', mode);
  }
}

export const NotificationManager = new NotificationManagerClass();
