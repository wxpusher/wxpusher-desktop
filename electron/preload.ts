import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS } from './ipc/ipcChannels';

const WINDOW_IS_MAXIMIZED_CHANNEL = 'window:is-maximized';
const WINDOW_MAXIMIZED_CHANGE_CHANNEL = 'window:maximized-change';

// 顶层自动注册：无论 renderer 是否订阅，preload 加载时即把
// online/offline 事件转发到主进程，确保网络变化能被 NetworkManager 立刻感知。
(() => {
  const log = (msg: string) => {
    try {
      ipcRenderer.send('debug:log', `[preload-network] ${msg}`);
    } catch {}
    try {
      console.log(`[preload-network] ${msg}`);
    } catch {}
  };

  log(`preload loaded, navigator.onLine=${navigator.onLine}`);

  try {
    ipcRenderer.send(IPC_CHANNELS.NETWORK_RENDERER_STATUS_CHANGED, navigator.onLine);
    log(`initial NETWORK_RENDERER_STATUS_CHANGED sent: ${navigator.onLine}`);
  } catch (e) {
    log(`initial send error: ${e}`);
  }

  window.addEventListener('online', () => {
    log('window event: online');
    ipcRenderer.send(IPC_CHANNELS.NETWORK_RENDERER_STATUS_CHANGED, true);
  });
  window.addEventListener('offline', () => {
    log('window event: offline');
    ipcRenderer.send(IPC_CHANNELS.NETWORK_RENDERER_STATUS_CHANGED, false);
  });

  // Network Information API：捕获「仍在线但换网/换 IP」（如 WiFi 切以太网），
  // online/offline 在这种场景不一定触发。防御式调用，API 不存在则跳过。
  const conn = (navigator as any).connection;
  if (conn && typeof conn.addEventListener === 'function') {
    conn.addEventListener('change', () => {
      log(`connection change: type=${conn.type ?? '-'} effectiveType=${conn.effectiveType ?? '-'}`);
      try {
        ipcRenderer.send(IPC_CHANNELS.NETWORK_RENDERER_CONNECTION_CHANGED);
      } catch (e) {
        log(`connection change send error: ${e}`);
      }
    });
  }
})();

contextBridge.exposeInMainWorld('electronAPI', {
  // 认证
  login: (code: string) => ipcRenderer.invoke(IPC_CHANNELS.AUTH_LOGIN, code),
  logout: () => ipcRenderer.invoke(IPC_CHANNELS.AUTH_LOGOUT),
  getCredential: () => ipcRenderer.invoke(IPC_CHANNELS.AUTH_GET_CREDENTIAL),

  // WS
  wsConnect: (pushToken?: string) => ipcRenderer.invoke(IPC_CHANNELS.WS_CONNECT, pushToken),
  wsDisconnect: () => ipcRenderer.invoke(IPC_CHANNELS.WS_DISCONNECT),
  hasPushToken: () => ipcRenderer.invoke(IPC_CHANNELS.WS_HAS_PUSH_TOKEN),
  isWsConnected: () => ipcRenderer.invoke(IPC_CHANNELS.WS_IS_CONNECTED),
  // P0 修复：返回清理函数，防止监听器泄漏
  onWsStatus: (callback: (status: string) => void) => {
    const handler = (_: any, status: string) => callback(status);
    ipcRenderer.on(IPC_CHANNELS.WS_STATUS, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.WS_STATUS, handler);
  },
  onNewMessage: (callback: (msg: any) => void) => {
    const handler = (_: any, msg: any) => callback(msg);
    ipcRenderer.on(IPC_CHANNELS.WS_NEW_MESSAGE, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.WS_NEW_MESSAGE, handler);
  },
  onPushToken: (callback: (token: string) => void) => {
    const handler = (_: any, token: string) => callback(token);
    ipcRenderer.on(IPC_CHANNELS.WS_PUSH_TOKEN, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.WS_PUSH_TOKEN, handler);
  },
  onAuthExpired: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on(IPC_CHANNELS.AUTH_EXPIRED, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.AUTH_EXPIRED, handler);
  },

  // 消息
  getMessageList: (params: any) => ipcRenderer.invoke(IPC_CHANNELS.MSG_LIST, params),
  markRead: (ids: number[], read: boolean) => ipcRenderer.invoke(IPC_CHANNELS.MSG_MARK_READ, ids, read),
  deleteMessages: (ids: number[]) => ipcRenderer.invoke(IPC_CHANNELS.MSG_DELETE, ids),
  deleteAllMessages: () => ipcRenderer.invoke(IPC_CHANNELS.MSG_DELETE_ALL),

  // 通知
  checkNotificationPermission: () => ipcRenderer.invoke(IPC_CHANNELS.NOTIFY_CHECK_PERMISSION),
  setNotificationMode: (mode: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.NOTIFY_SET_MODE, mode),
  onNotificationModeChanged: (callback: (mode: string) => void) => {
    const handler = (_: any, mode: string) => callback(mode);
    ipcRenderer.on(IPC_CHANNELS.NOTIFY_SET_MODE, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.NOTIFY_SET_MODE, handler);
  },
  openNotificationSettings: () => ipcRenderer.invoke(IPC_CHANNELS.NOTIFY_OPEN_SETTINGS),
  onNotificationClick: (callback: (messageId: number) => void) => {
    ipcRenderer.on(IPC_CHANNELS.NOTIFY_CLICK, (_, id) => callback(id));
  },

  // 主题
  getTheme: () => ipcRenderer.invoke(IPC_CHANNELS.THEME_GET),
  onThemeChanged: (callback: (isDark: boolean) => void) => {
    ipcRenderer.on(IPC_CHANNELS.THEME_CHANGED, (_, isDark) => callback(isDark));
  },

  // 偏好
  getPref: (key: string) => ipcRenderer.invoke(IPC_CHANNELS.PREF_GET, key),
  setPref: (key: string, value: any) => ipcRenderer.invoke(IPC_CHANNELS.PREF_SET, key, value),
  getAllPrefs: () => ipcRenderer.invoke(IPC_CHANNELS.PREF_GET_ALL),

  // 自动更新
  getAppVersion: () => ipcRenderer.invoke(IPC_CHANNELS.APP_GET_VERSION),
  checkUpdate: () => ipcRenderer.invoke(IPC_CHANNELS.UPDATE_CHECK),
  downloadUpdate: () => ipcRenderer.invoke(IPC_CHANNELS.UPDATE_DOWNLOAD),
  installUpdate: () => ipcRenderer.invoke(IPC_CHANNELS.UPDATE_INSTALL),
  onUpdateStatus: (callback: (status: any) => void) => {
    const handler = (_: any, status: any) => callback(status);
    ipcRenderer.on(IPC_CHANNELS.UPDATE_STATUS, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.UPDATE_STATUS, handler);
  },
  onUpdateRequired: (callback: (msg: any) => void) => {
    const handler = (_: any, msg: any) => callback(msg);
    ipcRenderer.on(IPC_CHANNELS.WS_UPDATE_REQUIRED, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.WS_UPDATE_REQUIRED, handler);
  },

  // 开机自启
  getAutoLaunch: () => ipcRenderer.invoke(IPC_CHANNELS.AUTO_LAUNCH_GET),
  setAutoLaunch: (enabled: boolean) => ipcRenderer.invoke(IPC_CHANNELS.AUTO_LAUNCH_SET, enabled),

  // 诊断
  runDiagnostics: () => ipcRenderer.invoke(IPC_CHANNELS.DIAG_RUN),

  // 网络状态：订阅主进程统一评估的网络状态（online/offline/unknown）
  // 注意：window.online/offline 已在 preload 顶层自动转发到主进程，无需此处处理。
  onNetworkStatusChanged: (callback: (isOnline: boolean) => void) => {
    const networkStatusHandler = (_: unknown, status: 'online' | 'offline' | 'unknown') => {
      callback(status === 'online');
    };

    callback(navigator.onLine);
    ipcRenderer.on(IPC_CHANNELS.NETWORK_STATUS, networkStatusHandler);

    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.NETWORK_STATUS, networkStatusHandler);
    };
  },

  // 详情 iframe 加载失败（主进程 did-fail-load 桥接，真实网络失败即时上报）
  onFrameLoadFail: (
    callback: (data: { url: string; errorCode: number; errorDescription: string }) => void
  ) => {
    const handler = (
      _: unknown,
      data: { url: string; errorCode: number; errorDescription: string }
    ) => callback(data);
    ipcRenderer.on(IPC_CHANNELS.IFRAME_LOAD_FAIL, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.IFRAME_LOAD_FAIL, handler);
  },

  // 平台信息
  getPlatform: () => ipcRenderer.invoke('system:get-platform'),
  isPackaged: () => ipcRenderer.invoke('system:is-packaged'),

  // 系统操作
  openExternal: (url: string) => ipcRenderer.invoke('system:open-external', url),
  showInFolder: (path: string) => ipcRenderer.invoke('system:show-in-folder', path),
  getDataPath: () => ipcRenderer.invoke('system:get-data-path'),

  // 登录二维码
  createLoginQrcode: () => ipcRenderer.invoke(IPC_CHANNELS.AUTH_CREATE_QRCODE),

  // 设备信息
  getUserDeviceInfo: () => ipcRenderer.invoke(IPC_CHANNELS.DEVICE_GET_INFO),
  getOpenId: () => ipcRenderer.invoke(IPC_CHANNELS.DEVICE_GET_OPENID),

  // Banner / CheckReason
  // 公告 banner：与 PushCheck 同构 —— 冷启动取缓存 + 订阅热更新；主进程统一节流。
  getLastListBanner: () => ipcRenderer.invoke(IPC_CHANNELS.MSG_LIST_BANNER_GET_LAST),
  onListBannerResult: (callback: (result: any) => void) => {
    const handler = (_: any, result: any) => callback(result);
    ipcRenderer.on(IPC_CHANNELS.MSG_LIST_BANNER_RESULT, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.MSG_LIST_BANNER_RESULT, handler);
  },
  checkNoMsg: () => ipcRenderer.invoke(IPC_CHANNELS.MSG_CHECK_NO_MSG),
  sendTestMessage: () => ipcRenderer.invoke(IPC_CHANNELS.MSG_SEND_TEST),
  getLastPushCheck: () => ipcRenderer.invoke(IPC_CHANNELS.MSG_PUSH_CHECK_GET_LAST),
  onPushCheckResult: (callback: (result: any) => void) => {
    const handler = (_: any, result: any) => callback(result);
    ipcRenderer.on(IPC_CHANNELS.MSG_PUSH_CHECK_RESULT, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.MSG_PUSH_CHECK_RESULT, handler);
  },

  // BrowserView
  showBrowserView: (url: string) => ipcRenderer.invoke(IPC_CHANNELS.WEBVIEW_SHOW, url),
  hideBrowserView: () => ipcRenderer.invoke(IPC_CHANNELS.WEBVIEW_HIDE),

  // 窗口
  minimizeWindow: () => ipcRenderer.invoke(IPC_CHANNELS.WINDOW_MINIMIZE),
  maximizeWindow: () => ipcRenderer.invoke(IPC_CHANNELS.WINDOW_MAXIMIZE),
  isMaximized: () => ipcRenderer.invoke(WINDOW_IS_MAXIMIZED_CHANNEL),
  onMaximizedChange: (callback: (maximized: boolean) => void) => {
    const handler = (_: unknown, maximized: boolean) => callback(maximized);
    ipcRenderer.on(WINDOW_MAXIMIZED_CHANGE_CHANNEL, handler);
    return () => ipcRenderer.removeListener(WINDOW_MAXIMIZED_CHANGE_CHANNEL, handler);
  },
  closeWindow: () => ipcRenderer.invoke(IPC_CHANNELS.WINDOW_CLOSE),

  // 环境配置（开发者选项）
  getEnvConfig: () => ipcRenderer.invoke(IPC_CHANNELS.ENV_GET_CONFIG),
  saveEnvConfig: (config: { baseUrl: string; wsUrl: string; appFeUrl: string }) =>
    ipcRenderer.invoke(IPC_CHANNELS.ENV_SAVE_CONFIG, config),
  resetEnvConfig: () => ipcRenderer.invoke(IPC_CHANNELS.ENV_RESET),
  restartApp: () => ipcRenderer.invoke('env:restart-app'),
});
