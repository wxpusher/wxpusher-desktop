import { BrowserWindow, BrowserView, screen, app, nativeTheme } from 'electron';
import path from 'path';
import { PreferencesManager } from './PreferencesManager';
import { PushCheckManager } from './PushCheckManager';
import { AnnouncementBannerManager } from './AnnouncementBannerManager';
import { logger } from '../utils/logger';
import { getResourcePath } from '../utils/platform';
const WIN_TITLEBAR_HEIGHT = 36;

function getTitleBarOverlay(isDark: boolean): Electron.TitleBarOverlay {
  return isDark
    ? { color: '#1E1E1E', symbolColor: '#E8E8E8', height: WIN_TITLEBAR_HEIGHT }
    : { color: '#ffffff', symbolColor: '#1a1a1a', height: WIN_TITLEBAR_HEIGHT };
}

export class WindowManager {
  private static mainWindow: BrowserWindow | null = null;
  private static detailWindows: Map<number, BrowserWindow> = new Map();
  private static currentBrowserView: BrowserView | null = null;

  static createMainWindow(): BrowserWindow {
    const prefs = PreferencesManager.getAll();

    // 恢复窗口位置
    let bounds: Electron.Rectangle | undefined;
    if (prefs.windowBounds) {
      const displays = screen.getAllDisplays();
      const display = displays.find((d) => String(d.id) === prefs.windowBounds!.displayId);
      if (display) {
        bounds = {
          x: prefs.windowBounds.x,
          y: prefs.windowBounds.y,
          width: prefs.windowBounds.w,
          height: prefs.windowBounds.h,
        };
      }
    }

    const platformOpts: Electron.BrowserWindowConstructorOptions =
      process.platform === 'darwin'
        ? {
            titleBarStyle: 'hiddenInset',
            trafficLightPosition: { x: 16, y: 16 },
          }
        : process.platform === 'win32'
          ? {
              titleBarStyle: 'hidden',
              titleBarOverlay: getTitleBarOverlay(nativeTheme.shouldUseDarkColors),
            }
          : {};

    const win = new BrowserWindow({
      width: bounds?.width || 1200,
      height: bounds?.height || 800,
      minWidth: 900,
      minHeight: 600,
      x: bounds?.x,
      y: bounds?.y,
      show: true,
      autoHideMenuBar: true,
      // Win/Linux 窗口与任务栏图标（dev 下默认是 Electron 图标，需显式指定；
      // 打包后仍由 electron-builder 的 win/linux icon 覆盖）。macOS 窗口无独立图标，忽略此项无害。
      icon: getResourcePath('icon.png'),
      ...platformOpts,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webviewTag: false,
      },
    });

    if (process.platform !== 'darwin') {
      win.removeMenu();
      win.setMenu(null);
      win.setMenuBarVisibility(false);
    }

    // 窗口状态持久化
    const saveBounds = () => {
      if (win.isDestroyed()) return;
      const b = win.getBounds();
      const display = screen.getDisplayMatching(b);
      PreferencesManager.set('windowBounds', {
        displayId: String(display.id),
        x: b.x,
        y: b.y,
        w: b.width,
        h: b.height,
      });
    };

    let boundsTimer: NodeJS.Timeout | null = null;
    const debouncedSave = () => {
      if (boundsTimer) clearTimeout(boundsTimer);
      boundsTimer = setTimeout(saveBounds, 500);
    };

    win.on('resize', debouncedSave);
    win.on('move', debouncedSave);

    // 主窗口每次显示触发推送检查 + 公告拉取（各自 1h 节流）：覆盖冷启动、托盘、Dock、第二实例所有路径
    win.on('show', () => {
      PushCheckManager.onWindowShown();
      AnnouncementBannerManager.onWindowShown();
    });

    // 关闭窗口:隐藏到后台,程序继续运行收消息;真正退出走托盘菜单
    win.on('close', (e) => {
      if (!(app as any).isQuitting) {
        e.preventDefault();
        win.hide(); // Win/Linux:隐藏后自动移出任务栏
        if (process.platform === 'darwin') app.dock?.hide(); // macOS:额外移除 Dock 图标
      }
    });

    // 需要调试时显式设置 ELECTRON_OPEN_DEVTOOLS=1，避免开发工具窗口干扰正常界面
    if (!app.isPackaged && process.env.ELECTRON_OPEN_DEVTOOLS === '1') {
      win.webContents.openDevTools({ mode: 'detach' });
    }

    this.mainWindow = win;
    return win;
  }

  static getMainWindow(): BrowserWindow | null {
    return this.mainWindow;
  }

  /** Windows：标题栏颜色跟随系统明暗主题 */
  static applyTitleBarTheme(isDark: boolean): void {
    if (process.platform !== 'win32') return;
    const win = this.mainWindow;
    if (!win || win.isDestroyed()) return;
    win.setTitleBarOverlay(getTitleBarOverlay(isDark));
  }

  static showMainWindow(): void {
    if (this.mainWindow) {
      if (process.platform === 'darwin') app.dock?.show();
      if (this.mainWindow.isMinimized()) this.mainWindow.restore();
      this.mainWindow.show();
      this.mainWindow.focus();
    }
  }

  static sendToRenderer(channel: string, ...args: any[]): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send(channel, ...args);
    }
  }

  static navigateToLogin(): void {
    const isPackaged = app.isPackaged;
    const devUrl = 'http://localhost:5173/#/login';
    const prodUrl = `file://${path.join(__dirname, '../dist/index.html#/login')}`;
    this.mainWindow?.loadURL(isPackaged ? prodUrl : devUrl);
  }

  static getAllWindows(): BrowserWindow[] {
    return [this.mainWindow, ...Array.from(this.detailWindows.values())].filter(
      (w): w is BrowserWindow => w !== null && !w.isDestroyed()
    );
  }

  // BrowserView 管理
  static showBrowserView(url: string): void {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) return;

    if (this.currentBrowserView) {
      this.mainWindow.removeBrowserView(this.currentBrowserView);
      this.currentBrowserView.webContents.destroy();
    }

    const view = new BrowserView({
      webPreferences: {
        preload: path.join(__dirname, 'preload-webview.js'),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        session: require('electron').session.fromPartition('persist:webview'),
      },
    });

    this.mainWindow.addBrowserView(view);
    const bounds = this.mainWindow.getContentBounds();
    const sidebarWidth = PreferencesManager.get('sidebarWidth');
    view.setBounds({
      x: sidebarWidth,
      y: 0,
      width: bounds.width - sidebarWidth,
      height: bounds.height,
    });
    view.webContents.loadURL(url);
    this.currentBrowserView = view;
  }

  static hideBrowserView(): void {
    if (this.mainWindow && this.currentBrowserView) {
      this.mainWindow.removeBrowserView(this.currentBrowserView);
      this.currentBrowserView.webContents.destroy();
      this.currentBrowserView = null;
    }
  }
}
