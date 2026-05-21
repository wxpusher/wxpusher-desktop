import { Notification, NotificationConstructorOptions, shell, app } from 'electron';
import path from 'path';
import { WindowManager } from './WindowManager';
import { PreferencesManager } from './PreferencesManager';
import { logger } from '../utils/logger';

class NotificationManagerClass {
  private notificationSound = true;

  init(): void {
    this.notificationSound = PreferencesManager.get('notificationSound');
  }

  showNotification(options: { title: string; body: string; messageId: number }): void {
    logger.info(`showNotification: sound=${this.notificationSound} title=${options.title}`);

    const notificationOptions: NotificationConstructorOptions = {
      title: options.title,
      body: options.body,
      silent: !this.notificationSound,
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

  setSound(enabled: boolean): void {
    this.notificationSound = enabled;
    PreferencesManager.set('notificationSound', enabled);
  }
}

export const NotificationManager = new NotificationManagerClass();
