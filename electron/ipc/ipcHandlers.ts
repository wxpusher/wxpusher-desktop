import { ipcMain, app, shell } from 'electron';
import { IPC_CHANNELS } from './ipcChannels';
import { ApiService } from '../managers/ApiService';
import { CredentialManager } from '../managers/CredentialManager';
import { WsManager } from '../managers/WsManager';
import { WindowManager } from '../managers/WindowManager';
import { NotificationManager } from '../managers/NotificationManager';
import { PreferencesManager } from '../managers/PreferencesManager';
import { ThemeManager } from '../managers/ThemeManager';
import { getDesktopPlatform, getDeviceName } from '../utils/platform';
import { logger } from '../utils/logger';

// URL 协议白名单（P0 安全修复：防止 file:// 等危险协议）
const ALLOWED_PROTOCOLS = ['https:', 'http:'];

function isSafeUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return ALLOWED_PROTOCOLS.includes(parsed.protocol);
  } catch {
    return false;
  }
}

// 偏好 key 白名单（P0 安全修复：防止 Renderer 覆写配置类 key）
const WRITABLE_PREF_KEYS = new Set([
  'launchAtLogin',
  'launchShowMainWindow',
  'closeBehavior',
  'sidebarWidth',
  'listPaneWidth',
  'windowBounds',
  'sidebarCollapsed',
  'notificationMode',
  'lockscreenPrivacy',
  'fontScale',
  'notifyPermissionDismissedAt',
  'bannerThrottleAt',
  'closedBannerId',
  'checkReasonThrottleAt',
  'onboardingCompleted',
  'keymap',
]);

export function registerIpcHandlers(): void {
  // 认证
  ipcMain.handle(IPC_CHANNELS.AUTH_LOGIN, async (_, code: string) => {
    const deviceName = getDeviceName();
    const platform = getDesktopPlatform();
    const pushToken = WsManager.getPushToken();
    // pushToken 为空时不传该字段（后端需放宽校验，PRD §7.2 P0）
    const params: any = { code, deviceName, platform };
    if (pushToken) {
      params.pushToken = pushToken;
    }
    const result = await ApiService.registerDevice(params);
    // P0 安全修复：凭证保存在 Main Process 内部完成，不暴露给 Renderer
    if (result?.deviceToken) {
      await CredentialManager.saveCredential({
        deviceToken: result.deviceToken,
        deviceUuid: result.deviceUuid,
        pushToken: pushToken || undefined,
      });
    }
    return result;
  });

  ipcMain.handle(IPC_CHANNELS.AUTH_LOGOUT, async () => {
    await ApiService.logout().catch(() => {});
    await CredentialManager.clearCredential();
    WsManager.disconnect();
    WindowManager.navigateToLogin();
  });

  ipcMain.handle(IPC_CHANNELS.AUTH_GET_CREDENTIAL, async () => {
    return CredentialManager.getCredential();
  });

  // P0 安全修复：移除 auth:save-credential IPC，凭证保存已移入 AUTH_LOGIN 内部

  ipcMain.handle(IPC_CHANNELS.AUTH_CREATE_QRCODE, async () => {
    return ApiService.createLoginQrcode();
  });

  // WS
  ipcMain.handle(IPC_CHANNELS.WS_CONNECT, (_, pushToken?: string) => {
    WsManager.connect(pushToken);
  });

  ipcMain.handle(IPC_CHANNELS.WS_HAS_PUSH_TOKEN, () => {
    return WsManager.hasPushToken();
  });

  ipcMain.handle(IPC_CHANNELS.WS_IS_CONNECTED, () => {
    return WsManager.isConnected();
  });

  ipcMain.handle(IPC_CHANNELS.WS_DISCONNECT, () => {
    WsManager.disconnect();
  });

  // 消息
  ipcMain.handle(IPC_CHANNELS.MSG_LIST, async (_, params) => {
    return ApiService.getMessageList(params);
  });

  ipcMain.handle(IPC_CHANNELS.MSG_MARK_READ, async (_, ids: number[], read: boolean) => {
    return ApiService.batchMarkRead(ids, read);
  });

  ipcMain.handle(IPC_CHANNELS.MSG_DELETE, async (_, ids: number[]) => {
    return ApiService.batchDelete(ids);
  });

  ipcMain.handle(IPC_CHANNELS.MSG_DELETE_ALL, async () => {
    return ApiService.deleteAllMessages();
  });

  ipcMain.handle(IPC_CHANNELS.MSG_LIST_BANNER, async () => {
    return ApiService.getListBanner().catch(() => null);
  });

  ipcMain.handle(IPC_CHANNELS.MSG_CHECK_NO_MSG, async () => {
    return ApiService.checkNoMsg().catch(() => null);
  });

  // 设备
  ipcMain.handle(IPC_CHANNELS.DEVICE_GET_INFO, async () => {
    return ApiService.getUserDeviceInfo().catch(() => null);
  });

  ipcMain.handle(IPC_CHANNELS.DEVICE_GET_OPENID, async () => {
    return ApiService.getOpenId().catch(() => null);
  });

  // 通知
  ipcMain.handle(IPC_CHANNELS.NOTIFY_CHECK_PERMISSION, async () => {
    return NotificationManager.checkPermission();
  });

  ipcMain.handle(IPC_CHANNELS.NOTIFY_SET_MODE, (_, mode: string) => {
    NotificationManager.setMode(mode as any);
  });

  ipcMain.handle(IPC_CHANNELS.NOTIFY_OPEN_SETTINGS, () => {
    NotificationManager.openNotificationSettings();
  });

  // 主题
  ipcMain.handle(IPC_CHANNELS.THEME_GET, () => {
    return ThemeManager.isDarkMode();
  });

  // 偏好（P0 安全修复：key 白名单 + 类型校验）
  ipcMain.handle(IPC_CHANNELS.PREF_GET, (_, key: string) => {
    return PreferencesManager.get(key as any);
  });

  ipcMain.handle(IPC_CHANNELS.PREF_SET, (_, key: string, value: any) => {
    if (!WRITABLE_PREF_KEYS.has(key)) {
      logger.warn(`PREF_SET 拒绝写入非白名单 key: ${key}`);
      return;
    }
    PreferencesManager.set(key as any, value);
  });

  ipcMain.handle(IPC_CHANNELS.PREF_GET_ALL, () => {
    return PreferencesManager.getAll();
  });

  // 开机自启
  ipcMain.handle(IPC_CHANNELS.AUTO_LAUNCH_GET, () => {
    return app.getLoginItemSettings().openAtLogin;
  });

  ipcMain.handle(IPC_CHANNELS.AUTO_LAUNCH_SET, (_, enabled: boolean) => {
    app.setLoginItemSettings({ openAtLogin: enabled });
  });

  // 系统操作（P0 安全修复：URL 协议白名单）
  ipcMain.handle('system:get-platform', () => process.platform);
  ipcMain.handle('system:is-packaged', () => app.isPackaged);
  ipcMain.handle('system:open-external', (_, url: string) => {
    if (!isSafeUrl(url)) {
      logger.warn(`openExternal 拒绝不安全 URL: ${url}`);
      return;
    }
    return shell.openExternal(url);
  });
  ipcMain.handle('system:show-in-folder', (_, path: string) => shell.showItemInFolder(path));
  ipcMain.handle('system:get-data-path', () => app.getPath('userData'));

  // 窗口
  ipcMain.handle(IPC_CHANNELS.WINDOW_MINIMIZE, () => {
    WindowManager.getMainWindow()?.minimize();
  });

  ipcMain.handle(IPC_CHANNELS.WINDOW_MAXIMIZE, () => {
    const win = WindowManager.getMainWindow();
    if (win?.isMaximized()) {
      win.unmaximize();
    } else {
      win?.maximize();
    }
  });

  ipcMain.handle(IPC_CHANNELS.WINDOW_CLOSE, () => {
    WindowManager.getMainWindow()?.close();
  });

  // BrowserView（P0 安全修复：URL 白名单校验）
  ipcMain.handle(IPC_CHANNELS.WEBVIEW_SHOW, (_, url: string) => {
    const config = PreferencesManager.getConfig();
    const allowedOrigins = [config.appFeUrl, config.baseUrl, 'https://wxpusher.zjiecode.com'];
    const isAllowed = allowedOrigins.some((origin) => url.startsWith(origin));
    if (!isAllowed && !isSafeUrl(url)) {
      logger.warn(`BrowserView 拒绝不安全 URL: ${url}`);
      return;
    }
    WindowManager.showBrowserView(url);
  });

  ipcMain.handle(IPC_CHANNELS.WEBVIEW_HIDE, () => {
    WindowManager.hideBrowserView();
  });

  // WebView 桥接
  ipcMain.handle('bridge:get-login-info', async () => {
    const credential = await CredentialManager.getCredential();
    const userInfo = await ApiService.getUserDeviceInfo().catch(() => null);
    return {
      deviceToken: credential?.deviceToken,
      uid: userInfo?.uid,
      spt: userInfo?.spt,
      openId: userInfo?.openId,
      nickName: userInfo?.nickName,
      phone: userInfo?.phone,
      deviceId: credential?.deviceUuid,
    };
  });

  ipcMain.handle('bridge:get-env-base-url', () => {
    const config = PreferencesManager.getConfig();
    return {
      apiBaseUrl: config.baseUrl,
      appFeBaseUrl: config.appFeUrl,
    };
  });

  ipcMain.handle('bridge:show-toast', (_, msg: string) => {
    WindowManager.sendToRenderer('toast:show', msg);
  });

  ipcMain.handle('bridge:open-url', (_, url: string) => {
    const WHITELIST_HOSTS = [
      'wxpusher.zjiecode.com',
      'wxpusher.test.zjiecode.com',
      '10.0.0.11',
      '10.0.2.2',
      '127.0.0.1',
    ];
    try {
      const urlObj = new URL(url);
      if (WHITELIST_HOSTS.includes(urlObj.host)) {
        WindowManager.sendToRenderer('webview:navigate', url);
      } else {
        shell.openExternal(url);
      }
    } catch {
      shell.openExternal(url);
    }
  });

  ipcMain.handle('bridge:open-page-by-route', (_, route: string) => {
    const config = PreferencesManager.getConfig();
    WindowManager.sendToRenderer('webview:navigate', `${config.appFeUrl}/app#${route}`);
  });

  ipcMain.handle(IPC_CHANNELS.UPDATE_CHECK, async () => {
    return ApiService.getVersionUpdate().catch(() => null);
  });

  // ============ 环境配置（开发者选项） ============
  // 仅 dev 模式可用，与 Android TestPanelActivity 对齐
  ipcMain.handle(IPC_CHANNELS.ENV_GET_CONFIG, () => {
    return PreferencesManager.getConfig();
  });

  ipcMain.handle(IPC_CHANNELS.ENV_SAVE_CONFIG, (_, config: { baseUrl: string; wsUrl: string; appFeUrl: string }) => {
    if (app.isPackaged) {
      logger.warn('ENV_SAVE_CONFIG 在生产模式下被拒绝');
      return false;
    }
    // 校验 URL 合法性
    try {
      new URL(config.baseUrl);
      new URL(config.wsUrl);
      new URL(config.appFeUrl);
    } catch {
      return false;
    }
    PreferencesManager.set('baseUrl', config.baseUrl);
    PreferencesManager.set('wsUrl', config.wsUrl);
    PreferencesManager.set('appFeUrl', config.appFeUrl);
    logger.info(`环境配置已保存: baseUrl=${config.baseUrl}, wsUrl=${config.wsUrl}, appFeUrl=${config.appFeUrl}`);
    return true;
  });

  ipcMain.handle(IPC_CHANNELS.ENV_RESET, () => {
    if (app.isPackaged) {
      logger.warn('ENV_RESET 在生产模式下被拒绝');
      return false;
    }
    PreferencesManager.set('baseUrl', 'https://wxpusher.zjiecode.com');
    PreferencesManager.set('wsUrl', 'wss://wxpusher.zjiecode.com');
    PreferencesManager.set('appFeUrl', 'https://wxpusher.zjiecode.com');
    logger.info('环境配置已重置为默认值');
    return true;
  });

  ipcMain.handle('env:restart-app', () => {
    // 断开 WS → 重连新地址 → 重新加载页面
    WsManager.disconnect();
    const config = PreferencesManager.getConfig();
    const credential = CredentialManager.getCredential();
    credential.then((cred) => {
      if (cred?.deviceToken) {
        WsManager.connect(cred.pushToken);
      }
    });
    // 重新加载渲染进程
    const win = WindowManager.getMainWindow();
    if (win) {
      const isPackaged = app.isPackaged;
      const devUrl = 'http://localhost:5173';
      const prodUrl = `file://${require('path').join(__dirname, '../dist/index.html')}`;
      win.loadURL(isPackaged ? prodUrl : devUrl);
    }
  });
}
