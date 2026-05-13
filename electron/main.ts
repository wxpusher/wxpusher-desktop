import { app, BrowserWindow, shell, Menu } from 'electron';
import path from 'path';
import { WindowManager } from './managers/WindowManager';
import { TrayManager } from './managers/TrayManager';
import { WsManager } from './managers/WsManager';
import { ThemeManager } from './managers/ThemeManager';
import { NotificationManager } from './managers/NotificationManager';
import { CredentialManager } from './managers/CredentialManager';
import { PreferencesManager } from './managers/PreferencesManager';
import { ApiService } from './managers/ApiService';
import { NetworkManager } from './managers/NetworkManager';
import { registerIpcHandlers } from './ipc/ipcHandlers';
import { setupCsp } from './utils/csp';

let mainWindow: BrowserWindow | null = null;

// 单实例锁
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
}

app.whenReady().then(async () => {
  // Linux/Windows 默认会显示 File/Edit/Window 等窗口菜单栏，去掉以与界面风格一致
  if (process.platform !== 'darwin') {
    Menu.setApplicationMenu(Menu.buildFromTemplate([]));
  }

  // 1. 初始化主题管理（必须最先）
  ThemeManager.init();

  // 2. 设置 CSP
  setupCsp();

  // 3. 注册 IPC handlers
  registerIpcHandlers();

  // 4. 创建主窗口
  mainWindow = WindowManager.createMainWindow();

  // 5. 初始化系统托盘
  TrayManager.init(mainWindow);

  // 6. 初始化通知管理器
  NotificationManager.init();

  // 7. 初始化网络管理器（统一处理网络变化与 WS 重连）
  NetworkManager.init();

  // 8. 检查是否有已保存的凭证（自动登录场景）
  const credential = await CredentialManager.getCredential();
  const isPackaged = app.isPackaged;
  const devUrl = 'http://localhost:5173';
  const prodUrl = `file://${path.join(__dirname, '../dist/index.html')}`; // dist-electron/../dist/index.html

  // 先注册 ready-to-show，再 loadURL，避免事件丢失
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  if (credential?.deviceToken) {
    WsManager.connect(credential.pushToken);
    mainWindow.loadURL(isPackaged ? prodUrl : devUrl);
  } else {
    // 无凭证时也连接 WS，等待服务器下发 pushToken（用于登录流程）
    WsManager.connect();
    const url = isPackaged ? `${prodUrl}#/login` : `${devUrl}#/login`;
    mainWindow.loadURL(url);
  }
});

// 第二个实例尝试启动时，聚焦已有窗口
app.on('second-instance', () => {
  WindowManager.showMainWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    mainWindow = WindowManager.createMainWindow();
    const isPackaged = app.isPackaged;
    const devUrl = 'http://localhost:5173';
    const prodUrl = `file://${path.join(__dirname, '../dist/index.html')}`; // dist-electron/../dist/index.html
    mainWindow.loadURL(isPackaged ? prodUrl : devUrl);
  }
});

// 打开外部链接时用系统浏览器
app.on('web-contents-created', (_, contents) => {
  contents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
});

// Debug: capture renderer errors
app.on('web-contents-created', (_, contents) => {
  contents.on('console-message', (_event, level, message, line, sourceId) => {
    const levels = ['verbose', 'info', 'warning', 'error'];
    console.log(`[RENDERER ${levels[level]}] ${message} (${sourceId}:${line})`);
  });
  contents.on('did-fail-load', (_event, errorCode, errorDesc, validatedURL) => {
    console.error(`[LOAD FAIL] ${errorCode}: ${errorDesc} URL: ${validatedURL}`);
  });
});
