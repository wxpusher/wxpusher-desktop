import { nativeTheme } from 'electron';
import { WindowManager } from './WindowManager';

export class ThemeManager {
  static init(): void {
    nativeTheme.themeSource = 'system';

    const notifyThemeChange = () => {
      const isDark = nativeTheme.shouldUseDarkColors;
      WindowManager.applyTitleBarTheme(isDark);
      WindowManager.sendToRenderer('theme:changed', isDark);
    };

    nativeTheme.on('updated', notifyThemeChange);
    notifyThemeChange();
  }

  static isDarkMode(): boolean {
    return nativeTheme.shouldUseDarkColors;
  }
}
