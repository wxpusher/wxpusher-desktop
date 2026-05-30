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
import { UpdateManager } from './managers/UpdateManager';
import { registerIpcHandlers } from './ipc/ipcHandlers';
import { refreshLinuxAutoLaunch } from './utils/linuxAutoLaunch';
import { IPC_CHANNELS } from './ipc/ipcChannels';
import { setupCsp } from './utils/csp';
import { getResourcePath } from './utils/platform';
import { APP_ID } from './utils/appId';

let mainWindow: BrowserWindow | null = null;

// 是否由"开机自启"触发启动:
// - macOS:系统提供 wasOpenedAtLogin
// - Windows/Linux:登录项启动时携带 AUTO_LAUNCH_SET 注入的 --opened-at-login 参数
function wasLaunchedAtLogin(): boolean {
  if (process.platform === 'darwin') {
    return app.getLoginItemSettings().wasOpenedAtLogin;
  }
  return process.argv.includes('--opened-at-login');
}

// 应用显示名称（macOS 菜单栏/程序坞、dev 模式默认会显示 "Electron"，需显式覆盖）
const APP_DISPLAY_NAME = 'WxPusher消息推送平台';
// Linux WM_CLASS 须为 ASCII，否则 GNOME 顶栏将 UTF-8 误作 Latin-1 显示乱码（Electron #33903）
const LINUX_WM_CLASS = 'wxpusher-desktop';
app.setName(process.platform === 'linux' ? LINUX_WM_CLASS : APP_DISPLAY_NAME);
// Windows 任务栏/通知归属，避免显示为 electron.app.*；
// 这里是"声明身份"的源头，必须用常量 APP_ID 而非 getAppId()
app.setAppUserModelId(APP_ID);

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

  // 3.1 Linux:若已开启开机自启,用当前可执行路径刷新 autostart 文件
  //     (应用更新或 AppImage 被移动后,旧 Exec 路径会失效,需重写以保证仍能拉起)
  refreshLinuxAutoLaunch();

  // 4. 创建主窗口
  mainWindow = WindowManager.createMainWindow();

  // 5. 初始化系统托盘
  TrayManager.init(mainWindow);

  // 6. 初始化通知管理器
  NotificationManager.init();

  // 7. 初始化网络管理器（统一处理网络变化与 WS 重连）
  NetworkManager.init();

  // 7.1 初始化更新管理器（启动 10s 后首检 + 每 4h 静默检查）
  UpdateManager.init();

  // 8. 检查是否有已保存的凭证（自动登录场景）
  const credential = await CredentialManager.getCredential();
  const isPackaged = app.isPackaged;
  const devUrl = 'http://localhost:5173';
  const prodUrl = `file://${path.join(__dirname, '../dist/index.html')}`; // dist-electron/../dist/index.html

  // 先注册 ready-to-show，再 loadURL，避免事件丢失
  // 开机自启启动时,若用户关闭了"启动后显示窗口",则只驻留托盘不弹窗;
  // 手动打开应用始终显示窗口,避免点了图标却看不到界面。
  mainWindow.once('ready-to-show', () => {
    if (!wasLaunchedAtLogin() || PreferencesManager.get('launchShowMainWindow')) {
      mainWindow?.show();
    } else if (process.platform === 'darwin') {
      // 仅驻留托盘不弹窗时,macOS 同步隐藏 Dock 图标
      app.dock?.hide();
    }
  });

  // pushToken 每 1h 兜底上报（幂等；未登录时定时器空转且自跳过，登录后自然生效）
  WsManager.startPushTokenReportSchedule();

  if (credential?.deviceToken) {
    WsManager.connect(credential.pushToken);
    mainWindow.loadURL(isPackaged ? prodUrl : devUrl);
  } else {
    // 无凭证时也连接 WS，复用上次未登录会话已落盘的 pushToken（若有），
    // 等待服务器下发 pushToken（用于登录流程）
    WsManager.connect(credential?.pushToken);
    const url = isPackaged ? `${prodUrl}#/login` : `${devUrl}#/login`;
    mainWindow.loadURL(url);
  }
});

// 第二个实例尝试启动时，聚焦已有窗口
app.on('second-instance', () => {
  WindowManager.showMainWindow();
});

// 安全网：任何真正退出路径都置位 isQuitting，放行 WindowManager 的 close 拦截，
// 并配合 autoUpdater.autoInstallOnAppQuit 让已下载的更新在退出时静默安装。
app.on('before-quit', () => {
  (app as unknown as { isQuitting: boolean }).isQuitting = true;
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  // 关窗后窗口只隐藏不销毁,优先唤回已隐藏窗口;确实不存在时才重建
  const win = WindowManager.getMainWindow();
  if (win && !win.isDestroyed()) {
    WindowManager.showMainWindow();
  } else {
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
    // 仅 error/warn 级别转发，避免 renderer 高频 debug 日志撑爆文件
    if (level >= 2) {
      console.log(`[RENDERER ${levels[level]}] ${message} (${sourceId}:${line})`);
    }
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
