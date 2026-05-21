import { Notification, NotificationConstructorOptions, shell, app } from 'electron';
import path from 'path';
import { WindowManager } from './WindowManager';
import { PreferencesManager } from './PreferencesManager';
import { logger } from '../utils/logger';

class NotificationManagerClass {
  private notificationMode: 'normal' | 'silent' | 'quiet' = 'normal';

  init(): void {
    this.notificationMode = PreferencesManager.get('notificationMode');
  }

  showNotification(options: { title: string; body: string; messageId: number }): void {
    logger.info(`showNotification: mode=${this.notificationMode} title=${options.title}`);

    // 静默通知:不弹系统横幅、不出声;消息列表已由 WsManager 的 ws:new-message 更新
    if (this.notificationMode === 'quiet') {
      logger.info('静默通知:跳过系统弹窗');
      return;
    }

    const notificationOptions: NotificationConstructorOptions = {
      title: options.title,
      body: options.body,
      silent: this.notificationMode === 'silent',
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

  setMode(mode: 'normal' | 'silent' | 'quiet'): void {
    this.notificationMode = mode;
    PreferencesManager.set('notificationMode', mode);
  }
}

export const NotificationManager = new NotificationManagerClass();
