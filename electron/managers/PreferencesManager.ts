import Store from 'electron-store';

export interface DesktopPreferences {
  launchAtLogin: boolean;
  launchShowMainWindow: boolean;
  closeBehavior: 'minimize_to_tray' | 'exit';
  sidebarWidth: number;
  listPaneWidth: number;
  windowBounds: { displayId: string; x: number; y: number; w: number; h: number } | null;
  sidebarCollapsed: boolean;
  notificationMode: 'all' | 'title_only' | 'badge_only' | 'muted';
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
  launchShowMainWindow: true,
  closeBehavior: 'minimize_to_tray',
  sidebarWidth: 220,
  listPaneWidth: 360,
  windowBounds: null,
  sidebarCollapsed: false,
  notificationMode: 'all',
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
