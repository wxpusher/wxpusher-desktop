import { Tray, Menu, nativeImage, BrowserWindow, app } from 'electron';
import { WindowManager } from './WindowManager';
import { PreferencesManager } from './PreferencesManager';
import { NotificationManager } from './NotificationManager';
import { logger } from '../utils/logger';
import { getResourcePath } from '../utils/platform';

type NotificationMode = 'normal' | 'silent' | 'quiet';

class TrayManagerClass {
  private tray: Tray | null = null;
  private mainWindow: BrowserWindow | null = null;
  private notificationMode: NotificationMode = 'normal';
  private lastUnreadCount = 0;

  // 按平台加载专用托盘图标(资源由 scripts/gen-tray-icons.mjs 生成):
  // - macOS:单色模板图标,菜单栏自动随深浅色反色;
  // - Windows:多尺寸 ICO,按 DPI 自动选尺寸;
  // - Linux:品牌紫 PNG。
  // createFromPath 会在 macOS/Linux 自动加载同目录的 @2x 版本。
  private loadTrayIcon(): Electron.NativeImage {
    const file =
      process.platform === 'darwin'
        ? 'trayTemplate.png'
        : process.platform === 'win32'
          ? 'tray.ico'
          : 'tray.png';

    try {
      const icon = nativeImage.createFromPath(getResourcePath(file));
      if (icon.isEmpty()) return nativeImage.createEmpty();
      if (process.platform === 'darwin') icon.setTemplateImage(true);
      return icon;
    } catch {
      return nativeImage.createEmpty();
    }
  }

  init(mainWindow: BrowserWindow): void {
    this.mainWindow = mainWindow;

    this.tray = new Tray(this.loadTrayIcon());
    this.tray.setToolTip('WxPusher');

    this.tray.on('click', () => {
      WindowManager.showMainWindow();
    });

    this.notificationMode = PreferencesManager.get('notificationMode');
    this.updateContextMenu(0);
  }

  // 设置页改动通知行为时,由 ipcHandler 调用,刷新托盘子菜单的单选勾选
  syncNotificationMode(mode: NotificationMode): void {
    this.notificationMode = mode;
    this.updateContextMenu(this.lastUnreadCount);
  }

  // 托盘子菜单点击通知行为
  private onModeClick(mode: NotificationMode): void {
    this.notificationMode = mode;
    NotificationManager.setMode(mode);
    WindowManager.sendToRenderer('notify:set-mode', mode);
  }

  // 托盘菜单：未读总数 + 显示窗口 + 通知行为 + 退出
  updateContextMenu(unreadCount: number): void {
    if (!this.tray) return;
    this.lastUnreadCount = unreadCount;

    const contextMenu = Menu.buildFromTemplate([
      {
        label: `WxPusher${unreadCount > 0 ? ` · 未读 ${unreadCount} 条` : ''}`,
        enabled: false,
      },
      { type: 'separator' },
      {
        label: '显示主窗口',
        click: () => WindowManager.showMainWindow(),
      },
      { type: 'separator' },
      {
        label: '通知行为',
        submenu: [
          {
            label: '正常通知',
            type: 'radio',
            checked: this.notificationMode === 'normal',
            click: () => this.onModeClick('normal'),
          },
          {
            label: '静音通知',
            type: 'radio',
            checked: this.notificationMode === 'silent',
            click: () => this.onModeClick('silent'),
          },
          {
            label: '不通知提醒',
            type: 'radio',
            checked: this.notificationMode === 'quiet',
            click: () => this.onModeClick('quiet'),
          },
        ],
      },
      { type: 'separator' },
      {
        label: '退出 WxPusher',
        click: () => {
          (app as any).isQuitting = true;
          app.quit();
        },
      },
    ]);

    this.tray.setContextMenu(contextMenu);
  }
}

export const TrayManager = new TrayManagerClass();
