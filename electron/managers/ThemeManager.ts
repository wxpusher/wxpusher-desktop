import { nativeTheme } from 'electron';
import { WindowManager } from './WindowManager';

export class ThemeManager {
  static init(): void {
    nativeTheme.themeSource = 'system';

    nativeTheme.on('updated', () => {
      const isDark = nativeTheme.shouldUseDarkColors;
      WindowManager.sendToRenderer('theme:changed', isDark);
    });
  }

  static isDarkMode(): boolean {
    return nativeTheme.shouldUseDarkColors;
  }
}
