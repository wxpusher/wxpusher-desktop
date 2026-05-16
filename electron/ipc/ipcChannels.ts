export const IPC_CHANNELS = {
  // 认证
  AUTH_LOGIN: 'auth:login',
  AUTH_LOGOUT: 'auth:logout',
  AUTH_GET_CREDENTIAL: 'auth:get-credential',
  AUTH_SAVE_CREDENTIAL: 'auth:save-credential',
  AUTH_EXPIRED: 'auth:expired',
  AUTH_CREATE_QRCODE: 'auth:create-qrcode',

  // WS
  WS_CONNECT: 'ws:connect',
  WS_DISCONNECT: 'ws:disconnect',
  WS_STATUS: 'ws:status',
  WS_PUSH_TOKEN: 'ws:push-token',
  WS_NEW_MESSAGE: 'ws:new-message',
  WS_ERROR: 'ws:error',
  WS_UPDATE_REQUIRED: 'ws:update-required',
  WS_HAS_PUSH_TOKEN: 'ws:has-push-token',
  WS_IS_CONNECTED: 'ws:is-connected',
  NETWORK_RENDERER_STATUS_CHANGED: 'network:renderer-status-changed',
  NETWORK_RENDERER_CONNECTION_CHANGED: 'network:renderer-connection-changed',
  NETWORK_STATUS: 'network:status',
  IFRAME_LOAD_FAIL: 'iframe:load-fail',

  // 消息
  MSG_LIST: 'msg:list',
  MSG_MARK_READ: 'msg:mark-read',
  MSG_DELETE: 'msg:delete',
  MSG_DELETE_ALL: 'msg:delete-all',
  MSG_LIST_BANNER: 'msg:list-banner',
  MSG_CHECK_NO_MSG: 'msg:check-no-msg',

  // 设备
  DEVICE_GET_INFO: 'device:get-info',
  DEVICE_GET_OPENID: 'device:get-openid',

  // 通知
  NOTIFY_CHECK_PERMISSION: 'notify:check-permission',
  NOTIFY_CLICK: 'notification:click',
  NOTIFY_SET_MODE: 'notify:set-mode',
  NOTIFY_OPEN_SETTINGS: 'notify:open-settings',

  // 主题
  THEME_CHANGED: 'theme:changed',
  THEME_GET: 'theme:get',

  // 窗口
  WINDOW_SHOW: 'window:show',
  WINDOW_HIDE: 'window:hide',
  WINDOW_MINIMIZE: 'window:minimize',
  WINDOW_MAXIMIZE: 'window:maximize',
  WINDOW_CLOSE: 'window:close',

  // 偏好
  PREF_GET: 'pref:get',
  PREF_SET: 'pref:set',
  PREF_GET_ALL: 'pref:get-all',

  // 自动更新
  UPDATE_CHECK: 'update:check',
  UPDATE_DOWNLOAD: 'update:download',
  UPDATE_STATUS: 'update:status',

  // 开机自启
  AUTO_LAUNCH_GET: 'auto-launch:get',
  AUTO_LAUNCH_SET: 'auto-launch:set',

  // 诊断
  DIAG_RUN: 'diag:run',

  // WebView
  WEBVIEW_SHOW: 'webview:show',
  WEBVIEW_HIDE: 'webview:hide',

  // 环境配置（开发者选项）
  ENV_SAVE_CONFIG: 'env:save-config',
  ENV_GET_CONFIG: 'env:get-config',
  ENV_RESET: 'env:reset',

  // WebView 桥接
  BRIDGE_GET_LOGIN_INFO: 'bridge:get-login-info',
  BRIDGE_GET_ENV_BASE_URL: 'bridge:get-env-base-url',
  BRIDGE_SHOW_TOAST: 'bridge:show-toast',
  BRIDGE_OPEN_URL: 'bridge:open-url',
} as const;
