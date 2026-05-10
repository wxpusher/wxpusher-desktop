import WebSocket from 'ws';
import { ipcMain } from 'electron';
import { WindowManager } from './WindowManager';
import { PreferencesManager } from './PreferencesManager';
import { CredentialManager } from './CredentialManager';
import { ApiService } from './ApiService';
import { getDesktopPlatform, getAppVersion } from '../utils/platform';
import { logger } from '../utils/logger';

enum WsStatus {
  NotConnect = 'NotConnect',
  Connecting = 'Connecting',
  Connected = 'Connected',
  Closing = 'Closing',
}

enum WsMsgType {
  UP_HEART = 101,
  DOWN_HEART = 201,
  DEVICE_INIT = 202,
  ERROR_MSG = 203,
  UPDATE_CLIENT = 204,
  PUSH_NOTE = 20001,
}

interface BaseWsMsg {
  msgType: number;
  createTime: number;
}

interface InitDeviceMsg extends BaseWsMsg {
  pushToken: string;
}

interface WsPushNoteMsg extends BaseWsMsg {
  mid: number;
  title: string;
  summary: string;
  url: string;
  sourceUrl: string;
  content: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class WsManagerClass {
  private ws: WebSocket | null = null;
  private status: WsStatus = WsStatus.NotConnect;
  private pushToken: string | null = null;
  private retryCount = 0;
  private retryTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private readTimeoutTimer: NodeJS.Timeout | null = null;
  private pollTimer: NodeJS.Timeout | null = null;
  private disconnectSince: number | null = null;
  private networkListenerRegistered = false;
  private readonly RETRY_SECONDS = [5, 10, 15, 20, 30, 45, 60, 120];
  private readonly HEARTBEAT_INTERVAL = 25_000;
  private readonly READ_TIMEOUT = 30_000; // P0: 30s 读超时，与服务端 IdleStateHandler 对齐

  connect(pushToken?: string | null): void {
    if (this.status === WsStatus.Connected || this.status === WsStatus.Connecting) {
      logger.info(`WS 跳过连接: 当前状态=${this.status}`);
      return;
    }
    this.pushToken = pushToken || null;
    this.status = WsStatus.Connecting;
    this.notifyStatusChange();

    const url = this.buildWsUrl();
    const connectStart = Date.now();
    logger.info(`WS 开始连接: ${url}`);

    try {
      const config = PreferencesManager.getConfig();
      this.ws = new WebSocket(url, {
        headers: {
          'User-Agent': `WxPusher-Desktop`,
          'Origin': config.appFeUrl,
          'version':getAppVersion(),
          'platform':getDesktopPlatform()
        },
      });

      this.ws.on('open', () => {
        logger.info(`WS 已连接 (耗时 ${Date.now() - connectStart}ms)`);
        this.status = WsStatus.Connected;
        this.retryCount = 0;
        this.disconnectSince = null;
        this.stopPollingFallback();
        this.notifyStatusChange();
        this.startHeartbeat();
        this.resetReadTimeout();
      });

      this.ws.on('message', (data: Buffer) => {
        this.resetReadTimeout();
        const raw = data.toString();
        try {
          const msg = JSON.parse(raw);
          logger.info(`WS 收到消息: msgType=${msg.msgType} pushToken=${(msg as any).pushToken || '-'} msg=${(msg as any).msg || '-'}`);
        } catch {}
        this.handleMessage(raw);
      });

      // P0: 监听 pong 帧，重置读超时
      this.ws.on('pong', () => {
        this.resetReadTimeout();
      });

      this.ws.on('close', (code, reason) => {
        logger.info(`WS 断开: code=${code} reason=${reason} (连接存活 ${Date.now() - connectStart}ms)`);
        this.cleanup();
        this.scheduleReconnect();
      });

      this.ws.on('error', (err) => {
        logger.warn('WS 错误:', err.message);
        this.cleanup();
        this.scheduleReconnect();
      });
    } catch (err) {
      logger.error('WS 创建失败:', err);
      this.scheduleReconnect();
    }

    this.setupNetworkMonitoring();
  }

  private buildWsUrl(): string {
    const config = PreferencesManager.getConfig();
    const platform = getDesktopPlatform();
    const version = getAppVersion();
    let url = `${config.wsUrl}/ws?version=${version}&platform=${platform}`;
    if (this.pushToken) {
      url += `&pushToken=${this.pushToken}`;
    }
    return url;
  }

  private handleMessage(raw: string): void {
    try {
      const msg: BaseWsMsg = JSON.parse(raw);
      switch (msg.msgType) {
        case WsMsgType.DOWN_HEART:
          break;
        case WsMsgType.DEVICE_INIT: {
          const initMsg = msg as InitDeviceMsg;
          this.pushToken = initMsg.pushToken;
          WindowManager.sendToRenderer('ws:push-token', initMsg.pushToken);
          this.reportPushToken(initMsg.pushToken);
          break;
        }
        case WsMsgType.PUSH_NOTE: {
          const pushMsg = msg as WsPushNoteMsg;
          WindowManager.sendToRenderer('ws:new-message', pushMsg);
          const { NotificationManager } = require('./NotificationManager');
          NotificationManager.showNotification({
            title: pushMsg.title || 'WxPusher',
            body: pushMsg.summary?.substring(0, 100) || '',
            messageId: pushMsg.mid,
          });
          break;
        }
        case WsMsgType.ERROR_MSG: {
          const errorMsg = msg as any;
          WindowManager.sendToRenderer('ws:error', errorMsg.msg);
          break;
        }
        case WsMsgType.UPDATE_CLIENT: {
          const updateMsg = msg as any;
          this.disconnect();
          WindowManager.sendToRenderer('ws:update-required', updateMsg);
          break;
        }
      }
    } catch (e) {
      logger.warn('WS 消息解析失败:', e);
    }
  }

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        // 发送 JSON 应用层心跳 (msgType=101)，与服务端 IdleStateHandler 对齐
        this.ws.send(JSON.stringify({ msgType: 101, createTime: Date.now() }));
      }
    }, this.HEARTBEAT_INTERVAL);
  }

  // P0: 读超时检测 — 30s 内无任何数据（消息/pong）则断开重连
  private resetReadTimeout(): void {
    if (this.readTimeoutTimer) clearTimeout(this.readTimeoutTimer);
    this.readTimeoutTimer = setTimeout(() => {
      logger.warn('WS 读超时，主动断开');
      this.ws?.terminate();
    }, this.READ_TIMEOUT);
  }

  private scheduleReconnect(): void {
    if (this.status === WsStatus.Closing) return;
    this.status = WsStatus.NotConnect;
    this.notifyStatusChange();

    // P0 修复：仅首次断连时启动降级轮询，避免重复创建定时器
    if (!this.disconnectSince) {
      this.disconnectSince = Date.now();
      this.startPollingFallback();
    }

    const delay = this.RETRY_SECONDS[Math.min(this.retryCount, this.RETRY_SECONDS.length - 1)];
    this.retryCount++;
    this.retryTimer = setTimeout(() => this.connect(this.pushToken), delay * 1000);
  }

  private async reportPushToken(pushToken: string): Promise<void> {
    // 未登录时跳过上报，pushToken 会在登录时通过 registerDevice 一起提交
    const credential = await CredentialManager.getCredential();
    if (!credential?.deviceToken) {
      logger.info('未登录，跳过 pushToken 上报');
      return;
    }
    const delays = [5_000, 15_000, 45_000];
    for (let i = 0; i < 3; i++) {
      try {
        await ApiService.updateDeviceInfo({ pushToken });
        return;
      } catch {
        if (i < 2) await sleep(delays[i]);
      }
    }
    logger.warn('pushToken 上报失败，已达最大重试次数');
  }

  private setupNetworkMonitoring(): void {
    if (this.networkListenerRegistered) return;
    this.networkListenerRegistered = true;
    ipcMain.on('network:status-changed', (_: any, isOnline: boolean) => {
      if (isOnline) {
        logger.info('网络恢复，立即尝试重连');
        this.retryCount = 0;
        if (this.status !== WsStatus.Connected) {
          this.connect(this.pushToken);
        }
        this.stopPollingFallback();
      }
    });
  }

  private startPollingFallback(): void {
    // disconnectSince 已在 scheduleReconnect 中设置
    setTimeout(() => {
      if (this.status !== WsStatus.Connected && this.disconnectSince) {
        this.pollTimer = setInterval(async () => {
          if (this.status === WsStatus.Connected) {
            this.stopPollingFallback();
            return;
          }
          try {
            const messages = await ApiService.getMessageList({
              messageId: Number.MAX_SAFE_INTEGER,
              key: '',
              scene: 2,
            });
            WindowManager.sendToRenderer('poll:messages', messages);
          } catch (e) {
            logger.warn('降级轮询失败', e);
          }
        }, 60_000);
      }
    }, 180_000);
  }

  private stopPollingFallback(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.disconnectSince = null;
  }

  disconnect(): void {
    this.status = WsStatus.Closing;
    this.cleanup();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.status = WsStatus.NotConnect;
    this.notifyStatusChange();
  }

  private cleanup(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    if (this.readTimeoutTimer) {
      clearTimeout(this.readTimeoutTimer);
      this.readTimeoutTimer = null;
    }
  }

  private notifyStatusChange(): void {
    WindowManager.sendToRenderer('ws:status', this.status);
  }

  getStatus(): WsStatus {
    return this.status;
  }

  isConnected(): boolean {
    return this.status === WsStatus.Connected;
  }

  getPushToken(): string | null {
    return this.pushToken;
  }

  hasPushToken(): boolean {
    return !!this.pushToken;
  }
}

export const WsManager = new WsManagerClass();
