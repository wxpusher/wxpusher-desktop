import { Tray, Menu, nativeImage, BrowserWindow, app } from 'electron';
import { WindowManager } from './WindowManager';
import { PreferencesManager } from './PreferencesManager';
import { NotificationManager } from './NotificationManager';
import { logger } from '../utils/logger';
import { getResourcePath } from '../utils/platform';

class TrayManagerClass {
  private tray: Tray | null = null;
  private mainWindow: BrowserWindow | null = null;
  private soundEnabled = true;

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

    this.soundEnabled = PreferencesManager.get('notificationSound');
    this.updateContextMenu(0);
  }

  // 托盘菜单：未读总数 + 显示窗口 + 通知声音 + 退出
  updateContextMenu(unreadCount: number): void {
    if (!this.tray) return;

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
        label: '通知声音',
        type: 'checkbox',
        checked: this.soundEnabled,
        click: (menuItem) => {
          this.soundEnabled = menuItem.checked;
          NotificationManager.setSound(this.soundEnabled);
          WindowManager.sendToRenderer('notify:set-sound', this.soundEnabled);
        },
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
