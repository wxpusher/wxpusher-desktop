import { app } from 'electron';
import Store from 'electron-store';
import type { BannerData, CheckAppMsgReason } from '../../src/types';

const PROD_BASE_URL = 'https://wxpusher.zjiecode.com';
const PROD_WS_URL = 'wss://wxpusher.zjiecode.com';
const PROD_APP_FE_URL = 'https://wxpusher.zjiecode.com';
const TEST_BASE_URL = 'http://wxpusher.test.zjiecode.com';
const TEST_WS_URL = 'ws://wxpusher.test.zjiecode.com';
const TEST_APP_FE_URL = 'http://wxpusher.test.zjiecode.com';

export interface DesktopPreferences {
  launchAtLogin: boolean;
  launchShowMainWindow: boolean;
  sidebarWidth: number;
  listPaneWidth: number;
  windowBounds: { displayId: string; x: number; y: number; w: number; h: number } | null;
  sidebarCollapsed: boolean;
  notificationMode: 'normal' | 'silent' | 'quiet';
  lockscreenPrivacy: boolean;
  fontScale: number;
  notifyPermissionDismissedAt: number | null;
  bannerThrottleAt: number;
  bannerLastResult: BannerData | null;
  closedBannerId: number | null;
  checkReasonThrottleAt: number;
  pushCheckLastResult: CheckAppMsgReason | null;
  onboardingCompleted: boolean;
  keymap: Record<string, string>;
  baseUrl: string;
  wsUrl: string;
  appFeUrl: string;
}

const defaults: DesktopPreferences = {
  launchAtLogin: false,
  launchShowMainWindow: false,
  sidebarWidth: 220,
  listPaneWidth: 360,
  windowBounds: null,
  sidebarCollapsed: false,
  notificationMode: 'normal',
  lockscreenPrivacy: false,
  fontScale: 1.0,
  notifyPermissionDismissedAt: null,
  bannerThrottleAt: 0,
  bannerLastResult: null,
  closedBannerId: null,
  checkReasonThrottleAt: 0,
  pushCheckLastResult: null,
  onboardingCompleted: false,
  keymap: {},
  // 打包后(production)默认连生产后端；dev 模式默认连测试后端，方便本地联调。
  baseUrl: app.isPackaged ? PROD_BASE_URL : TEST_BASE_URL,
  wsUrl: app.isPackaged ? PROD_WS_URL : TEST_WS_URL,
  appFeUrl: app.isPackaged ? PROD_APP_FE_URL : TEST_APP_FE_URL,
};

const store = new Store<DesktopPreferences>({ defaults });

// 一次性迁移:notificationSound 布尔(中间版本) 与 旧 4 档 notificationMode → 新三档
if (store.has('notificationSound' as any)) {
  store.set('notificationMode', store.get('notificationSound' as any) ? 'normal' : 'silent');
  store.delete('notificationSound' as any);
}
const legacyMode = store.get('notificationMode' as any) as string | undefined;
if (legacyMode && !['normal', 'silent', 'quiet'].includes(legacyMode)) {
  const map: Record<string, 'normal' | 'silent' | 'quiet'> = {
    all: 'normal',
    title_only: 'normal',
    muted: 'silent',
    badge_only: 'quiet',
  };
  store.set('notificationMode', map[legacyMode] ?? 'normal');
}

// 一次性清理:closeBehavior 开关已移除,关窗统一隐藏到后台。
if (store.has('closeBehavior' as any)) {
  store.delete('closeBehavior' as any);
}

// 迁移:旧版本打包产物默认就是测试地址且没有切换 UI,升级到新版后强制切到生产。
// dev 模式不动,允许开发者继续使用测试或自定义地址。
if (app.isPackaged) {
  if (store.get('baseUrl') === TEST_BASE_URL) {
    store.set('baseUrl', PROD_BASE_URL);
  }
  if (store.get('wsUrl') === TEST_WS_URL) {
    store.set('wsUrl', PROD_WS_URL);
  }
  if (store.get('appFeUrl') === TEST_APP_FE_URL) {
    store.set('appFeUrl', PROD_APP_FE_URL);
  }
}

export class PreferencesManager {
  static get<K extends keyof DesktopPreferences>(key: K): DesktopPreferences[K] {
    return store.get(key);
  }

  static set<K extends keyof DesktopPreferences>(key: K, value: DesktopPreferences[K]): void {
    store.set(key, value);
  }

  static getAll(): DesktopPreferences {
    return store.store;
  }

  static getConfig(): { baseUrl: string; wsUrl: string; appFeUrl: string } {
    return {
      baseUrl: store.get('baseUrl'),
      wsUrl: store.get('wsUrl'),
      appFeUrl: store.get('appFeUrl'),
    };
  }
}
