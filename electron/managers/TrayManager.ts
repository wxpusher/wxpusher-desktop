import { Tray, Menu, nativeImage, BrowserWindow, app } from 'electron';
import path from 'path';
import { WindowManager } from './WindowManager';
import { PreferencesManager } from './PreferencesManager';
import { logger } from '../utils/logger';

class TrayManagerClass {
  private tray: Tray | null = null;
  private mainWindow: BrowserWindow | null = null;
  private muted = false;
  private paused = false;

  init(mainWindow: BrowserWindow): void {
    this.mainWindow = mainWindow;

    const iconPath = path.join(__dirname, '../../resources/icon.png');
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

    this.muted = PreferencesManager.get('notificationMode') === 'muted';
    this.updateContextMenu(0);
  }

  // P0 补齐：静音模式 + 暂停接收 + 未读总数
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
        label: '静音模式',
        type: 'checkbox',
        checked: this.muted,
        click: (menuItem) => {
          this.muted = menuItem.checked;
          const mode = this.muted ? 'muted' : 'all';
          PreferencesManager.set('notificationMode', mode as any);
          WindowManager.sendToRenderer('notify:set-mode', mode);
        },
      },
      {
        label: '暂停接收',
        type: 'checkbox',
        checked: this.paused,
        click: (menuItem) => {
          this.paused = menuItem.checked;
          if (this.paused) {
            WindowManager.sendToRenderer('ws:pause', true);
          } else {
            WindowManager.sendToRenderer('ws:pause', false);
          }
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
