export interface MessageItem {
  messageId: number;
  name: string;
  summary: string;
  url: string;
  sourceUrl: string;
  read: boolean;
  createTime: number;
}

export interface LoginInfo {
  version: number;
  deviceToken: string;
  deviceUuid: string;
  uid: string;
  spt: string;
  openId: string;
  nickName: string;
  phone: string;
  wxBind: boolean;
  appleBind: boolean;
}

export interface BannerData {
  id: number;
  title: string;
  desc?: string;
  url?: string;
}

export interface CheckAppMsgReason {
  code: number;
  hasMsg: boolean;
  hasPush: boolean;
  reason: string;
}

export interface WsPushNoteMsg {
  msgType: number;
  createTime: number;
  mid: number;
  title: string;
  summary: string;
  url: string;
  sourceUrl: string;
  content: string;
}

export interface UserDeviceInfo {
  uid: string;
  spt: string;
  openId: string;
  nickName: string;
  phone: string;
  deviceUuid: string;
}

// 扩展 Window 接口
declare global {
  interface Window {
    electronAPI: {
      login: (code: string) => Promise<{ deviceToken: string; deviceUuid: string }>;
      logout: () => Promise<void>;
      getCredential: () => Promise<{ deviceToken: string; deviceUuid: string; pushToken?: string } | null>;
      createLoginQrcode: () => Promise<{ code: string; expires: number }>;
      wsConnect: (pushToken?: string) => Promise<void>;
      wsDisconnect: () => Promise<void>;
      hasPushToken: () => Promise<boolean>;
      isWsConnected: () => Promise<boolean>;
      // P0 修复：返回清理函数
      onWsStatus: (callback: (status: string) => void) => (() => void) | undefined;
      onNewMessage: (callback: (msg: WsPushNoteMsg) => void) => (() => void) | undefined;
      onPushToken: (callback: (token: string) => void) => (() => void) | undefined;
      onAuthExpired: (callback: () => void) => (() => void) | undefined;
      getMessageList: (params: { messageId?: number; key?: string; scene: number }) => Promise<MessageItem[]>;
      markRead: (ids: number[], read: boolean) => Promise<void>;
      deleteMessages: (ids: number[]) => Promise<{ success: number; failed: number }>;
      deleteAllMessages: () => Promise<void>;
      checkNotificationPermission: () => Promise<{ supported: boolean; granted: boolean }>;
      setNotificationMode: (mode: string) => Promise<void>;
      openNotificationSettings: () => Promise<void>;
      onNotificationClick: (callback: (messageId: number) => void) => (() => void) | undefined;
      getTheme: () => Promise<boolean>;
      onThemeChanged: (callback: (isDark: boolean) => void) => (() => void) | undefined;
      getPref: (key: string) => Promise<unknown>;
      setPref: (key: string, value: unknown) => Promise<void>;
      getAllPrefs: () => Promise<Record<string, unknown>>;
      checkUpdate: () => Promise<unknown>;
      onUpdateStatus: (callback: (status: unknown) => void) => void;
      getAutoLaunch: () => Promise<boolean>;
      setAutoLaunch: (enabled: boolean) => Promise<void>;
      runDiagnostics: () => Promise<unknown>;
      onNetworkStatusChanged: (callback: (isOnline: boolean) => void) => (() => void) | undefined;
      getPlatform: () => Promise<string>;
      isPackaged: () => Promise<boolean>;
      openExternal: (url: string) => Promise<void>;
      showInFolder: (path: string) => Promise<void>;
      getDataPath: () => Promise<string>;
      getUserDeviceInfo: () => Promise<UserDeviceInfo | null>;
      getOpenId: () => Promise<string | null>;
      getListBanner: () => Promise<BannerData | null>;
      checkNoMsg: () => Promise<CheckAppMsgReason | null>;
      showBrowserView: (url: string) => Promise<void>;
      hideBrowserView: () => Promise<void>;
      minimizeWindow: () => Promise<void>;
      maximizeWindow: () => Promise<void>;
      closeWindow: () => Promise<void>;

      // 环境配置（开发者选项）
      getEnvConfig: () => Promise<{ baseUrl: string; wsUrl: string; appFeUrl: string }>;
      saveEnvConfig: (config: { baseUrl: string; wsUrl: string; appFeUrl: string }) => Promise<boolean>;
      resetEnvConfig: () => Promise<boolean>;
      restartApp: () => Promise<void>;
    };
  }
}
