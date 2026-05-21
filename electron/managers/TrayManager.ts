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

  init(mainWindow: BrowserWindow): void {
    this.mainWindow = mainWindow;

    const iconPath = getResourcePath('icon.png');
    let trayIcon: Electron.NativeImage;

    try {
      trayIcon = nativeImage.createFromPath(iconPath);
      if (trayIcon.isEmpty()) {
        trayIcon = nativeImage.createEmpty();
      }
    } catch {
      trayIcon = nativeImage.createEmpty();
    }

    // macOS 菜单栏图标需要缩小
    if (process.platform === 'darwin') {
      trayIcon = trayIcon.resize({ width: 18, height: 18 });
      trayIcon.setTemplateImage(true);
    }

    this.tray = new Tray(trayIcon);
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
