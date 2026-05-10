import { Notification, NotificationConstructorOptions, shell, app } from 'electron';
import path from 'path';
import { WindowManager } from './WindowManager';
import { PreferencesManager } from './PreferencesManager';
import { logger } from '../utils/logger';

class NotificationManagerClass {
  private notificationMode: 'all' | 'title_only' | 'badge_only' | 'muted' = 'all';

  init(): void {
    this.notificationMode = PreferencesManager.get('notificationMode');
  }

  showNotification(options: { title: string; body: string; messageId: number }): void {
    if (this.notificationMode === 'badge_only' || this.notificationMode === 'muted') {
      this.updateBadge();
      return;
    }

    const notificationOptions: NotificationConstructorOptions = {
      title: options.title,
      body: this.notificationMode === 'title_only' ? '' : options.body,
      silent: this.notificationMode === 'muted',
    };

    try {
      const notification = new Notification(notificationOptions);
      notification.on('click', () => {
        WindowManager.showMainWindow();
        WindowManager.sendToRenderer('notification:click', options.messageId);
      });
      notification.show();
    } catch (e) {
      logger.warn('发送通知失败:', e);
    }
  }

  async checkPermission(): Promise<{ supported: boolean; granted: boolean }> {
    const supported = Notification.isSupported();
    if (!supported) return { supported: false, granted: false };

    if (process.platform === 'darwin') {
      try {
        const testNotification = new Notification({
          title: '',
          body: '',
          silent: true,
          timeoutType: 'never',
        });
        return { supported: true, granted: true };
      } catch {
        return { supported: true, granted: false };
      }
    }

    return { supported: true, granted: true };
  }

  openNotificationSettings(): void {
    switch (process.platform) {
      case 'darwin':
        shell.openExternal('x-apple.systempreferences:com.apple.preference.notifications');
        break;
      case 'win32':
        shell.openExternal('ms-settings:notifications');
        break;
      default:
        WindowManager.sendToRenderer('notification:linux-hint');
        break;
    }
  }

  setMode(mode: 'all' | 'title_only' | 'badge_only' | 'muted'): void {
    this.notificationMode = mode;
    PreferencesManager.set('notificationMode', mode);
  }

  private updateBadge(): void {
    // 更新未读徽标计数
    if (process.platform === 'darwin') {
      // macOS dock badge 由渲染进程通过 IPC 设置
    }
  }
}

export const NotificationManager = new NotificationManagerClass();
