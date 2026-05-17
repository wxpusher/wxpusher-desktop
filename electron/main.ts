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
import { IPC_CHANNELS } from './ipc/ipcChannels';
import { setupCsp } from './utils/csp';
import { getResourcePath } from './utils/platform';

let mainWindow: BrowserWindow | null = null;

// 应用显示名称（macOS 菜单栏/程序坞、dev 模式默认会显示 "Electron"，需显式覆盖）
const APP_NAME = 'WxPusher消息推送平台';
app.setName(APP_NAME);
// Windows 任务栏/通知归属，避免显示为 electron.app.*
app.setAppUserModelId('com.smjcco.wxpusher.desktop');

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

  // macOS 程序坞图标：dev（未打包）默认显示 Electron 图标，需显式设置；
  // 用形状化的 icon-mac.png（圆角 squircle + 留白 + 阴影，符合 macOS 规范），
  // 而非满画幅方形 icon.png（后者供 Win/Linux）。打包后程序坞由 icon.icns 决定。
  if (process.platform === 'darwin' && app.dock) {
    app.dock.setIcon(getResourcePath('icon-mac.png'));
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
  // 真实网络错误（DNS/连接/断网/超时等）：iframe 子框架失败上报渲染层即时显示失败界面。
  // HTTP 错误状态（如 502）不走此事件，由 webRequest.onCompleted 兜住（见 utils/csp.ts）。
  // errorCode -3 (ERR_ABORTED) 是切换消息/重试重挂 iframe 的正常中止，忽略。
  contents.on(
    'did-fail-load',
    (_event, errorCode, errorDesc, validatedURL, isMainFrame) => {
      console.error(`[LOAD FAIL] ${errorCode}: ${errorDesc} URL: ${validatedURL}`);
      if (!isMainFrame && errorCode !== -3) {
        WindowManager.sendToRenderer(IPC_CHANNELS.IFRAME_LOAD_FAIL, {
          url: validatedURL,
          errorCode,
          errorDescription: errorDesc,
        });
      }
    }
  );
});
