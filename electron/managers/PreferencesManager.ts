import Store from 'electron-store';

export interface DesktopPreferences {
  launchAtLogin: boolean;
  launchShowMainWindow: boolean;
  sidebarWidth: number;
  listPaneWidth: number;
  windowBounds: { displayId: string; x: number; y: number; w: number; h: number } | null;
  sidebarCollapsed: boolean;
  notificationSound: boolean;
  lockscreenPrivacy: boolean;
  fontScale: number;
  notifyPermissionDismissedAt: number | null;
  bannerThrottleAt: number;
  closedBannerId: number | null;
  checkReasonThrottleAt: number;
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
  notificationSound: true,
  lockscreenPrivacy: false,
  fontScale: 1.0,
  notifyPermissionDismissedAt: null,
  bannerThrottleAt: 0,
  closedBannerId: null,
  checkReasonThrottleAt: 0,
  onboardingCompleted: false,
  keymap: {},
  baseUrl: 'http://wxpusher.test.zjiecode.com',
  wsUrl: 'ws://wxpusher.test.zjiecode.com',
  appFeUrl: 'http://wxpusher.test.zjiecode.com',
};

const store = new Store<DesktopPreferences>({ defaults });

// 一次性迁移：旧版本用 notificationMode（all/title_only/badge_only/muted），
// 现已统一为 notificationSound 开关。曾设为 muted/badge_only 的用户保留为静音。
if (store.has('notificationMode' as any)) {
  const legacy = store.get('notificationMode' as any) as string;
  if (legacy === 'muted' || legacy === 'badge_only') {
    store.set('notificationSound', false);
  }
  store.delete('notificationMode' as any);
}

// 一次性清理:closeBehavior 开关已移除,关窗统一隐藏到后台。
if (store.has('closeBehavior' as any)) {
  store.delete('closeBehavior' as any);
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
