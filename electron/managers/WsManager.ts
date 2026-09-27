import WebSocket from 'ws';
import { WindowManager } from './WindowManager';
import { PreferencesManager } from './PreferencesManager';
import { CredentialManager } from './CredentialManager';
import { NotificationManager } from './NotificationManager';
import { ApiService } from './ApiService';
import { getDesktopPlatform, getAppVersion } from '../utils/platform';
import { logger } from '../utils/logger';
import { WS_STATUS, type WsStatusValue } from '../ipc/wsStatus';

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
  name: string;
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
  private generation = 0;
  private shouldReconnect = false;
  private status: WsStatusValue = WS_STATUS.NotConnect;
  private pushToken: string | null = null;
  private retryCount = 0;
  private retryTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private readTimeoutTimer: NodeJS.Timeout | null = null;
  private stableConnectionTimer: NodeJS.Timeout | null = null;
  private pollTimer: NodeJS.Timeout | null = null;
  private pollDelayTimer: NodeJS.Timeout | null = null;
  private pollInFlight = false;
  private networkChangeTimer: NodeJS.Timeout | null = null;
  private pushTokenReportTimer: NodeJS.Timeout | null = null;
  private disconnectSince: number | null = null;
  private networkOnline: boolean | null = null;
  private readonly recentMessageIds = new Set<number>();
  private readonly recentMessageOrder: number[] = [];
  private readonly RETRY_SECONDS = [5, 10, 15, 20, 30, 45, 60, 120];
  private readonly HEARTBEAT_INTERVAL = 25_000;
  // 服务端 30s 首次空闲只探活、60s 才关闭；客户端留出代理与调度抖动余量。
  private readonly READ_TIMEOUT = 90_000;
  private readonly STABLE_CONNECTION_TIME = 60_000;
  private readonly PUSH_TOKEN_REPORT_INTERVAL = 60 * 60 * 1000; // 1h 定时上报兜底

  connect(pushToken?: string | null, forceReconnect = false): void {
    this.shouldReconnect = true;
    if (pushToken) this.pushToken = pushToken;

    if (this.networkOnline === false) {
      logger.info('WS 跳过连接: 当前网络离线');
      this.status = WS_STATUS.Offline;
      this.notifyStatusChange();
      return;
    }

    if (!forceReconnect && (this.status === WS_STATUS.Connected || this.status === WS_STATUS.Connecting)) {
      // 已连接/连接中时的跳过是 no-op,不打印(真实状态转换已在别处记录)
      return;
    }

    // 手动连接可能发生在退避等待期间，实际开始新连接前必须取消旧定时器。
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }

    if (forceReconnect) {
      this.invalidateCurrentSocket(true);
      this.status = WS_STATUS.NotConnect;
    }

    this.status = WS_STATUS.Connecting;
    this.notifyStatusChange();

    const url = this.buildWsUrl();
    const connectStart = Date.now();
    logger.info(`WS 开始连接: ${url}`);

    try {
      const config = PreferencesManager.getConfig();
      const socket = new WebSocket(url, {
        headers: {
          'User-Agent': `WxPusher-Desktop`,
          'Origin': config.appFeUrl,
          'version':getAppVersion(),
          'platform':getDesktopPlatform()
        },
      });
      const generation = ++this.generation;
      this.ws = socket;
      let terminalHandled = false;

      socket.on('open', () => {
        if (!this.isCurrent(socket, generation)) return;
        logger.info(`WS 已连接 (耗时 ${Date.now() - connectStart}ms)`);
        this.status = WS_STATUS.Connected;
        this.notifyStatusChange();
        this.startHeartbeat(socket, generation);
        this.resetReadTimeout(socket, generation);
        this.scheduleStableRetryReset(socket, generation);
      });

      socket.on('message', (data: Buffer) => {
        if (!this.isCurrent(socket, generation)) return;
        this.resetReadTimeout(socket, generation);
        const raw = data.toString();
        try {
          const msg = JSON.parse(raw);
          const logDetail = msg.msgType === 20001 ? `mid=${msg.mid} title=${msg.title}` : `pushToken=${(msg as any).pushToken || '-'} msg=${(msg as any).msg || '-'}`;
          logger.debug(`WS 收到消息: msgType=${msg.msgType} ${logDetail}`);
        } catch {}
        this.handleMessage(raw);
      });

      // ws 库在收到服务端 Ping 时会自动回 Pong；两种控制帧都证明读链路正常。
      socket.on('ping', () => {
        if (this.isCurrent(socket, generation)) this.resetReadTimeout(socket, generation);
      });
      socket.on('pong', () => {
        if (this.isCurrent(socket, generation)) this.resetReadTimeout(socket, generation);
      });

      const handleTerminal = (detail: string): void => {
        if (terminalHandled || !this.isCurrent(socket, generation)) return;
        terminalHandled = true;
        logger.info(`${detail} (连接存活 ${Date.now() - connectStart}ms)`);
        this.ws = null;
        this.cleanupConnectionTimers();
        this.scheduleReconnect();
      };

      socket.on('close', (code, reason) => {
        handleTerminal(`WS 断开: code=${code} reason=${reason}`);
      });

      socket.on('error', (err) => {
        logger.warn('WS 错误:', err.message);
        handleTerminal('WS 因错误断开');
        socket.terminate();
      });
    } catch (err) {
      logger.error('WS 创建失败:', err);
      this.cleanupConnectionTimers();
      this.scheduleReconnect();
    }

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
          // 服务端下发后立即落盘（不依赖登录），后续连接复用，避免重复下发
          CredentialManager.savePushToken(initMsg.pushToken).catch((e) =>
            logger.warn('pushToken 落盘失败:', e)
          );
          WindowManager.sendToRenderer('ws:push-token', initMsg.pushToken);
          this.reportPushToken(initMsg.pushToken);
          break;
        }
        case WsMsgType.PUSH_NOTE: {
          const pushMsg = msg as WsPushNoteMsg;
          if (this.isDuplicateMessage(pushMsg.mid)) {
            logger.info(`PUSH_NOTE 重复消息已忽略: mid=${pushMsg.mid}`);
            break;
          }
          logger.info(`PUSH_NOTE 收到: mid=${pushMsg.mid} title=${pushMsg.title} summary=${pushMsg.summary?.substring(0, 50)}`);
          try {
            WindowManager.sendToRenderer('ws:new-message', pushMsg);
            logger.debug('PUSH_NOTE 已发送到 renderer');
          } catch (e) {
            logger.warn('PUSH_NOTE 发送到 renderer 失败:', e);
          }
          try {
            NotificationManager.showNotification({
              title: pushMsg.title || 'WxPusher',
              body: pushMsg.summary?.substring(0, 100) || '',
              messageId: pushMsg.mid,
            });
            logger.debug('PUSH_NOTE 通知已调用');
          } catch (e) {
            logger.warn('PUSH_NOTE 通知失败:', e);
          }
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

  private startHeartbeat(socket: WebSocket, generation: number): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = setInterval(() => {
      if (this.isCurrent(socket, generation) && socket.readyState === WebSocket.OPEN) {
        // 发送 JSON 应用层心跳 (msgType=101)，与服务端 IdleStateHandler 对齐
        socket.send(JSON.stringify({ msgType: 101, createTime: Date.now() }));
      }
    }, this.HEARTBEAT_INTERVAL);
  }

  private isDuplicateMessage(messageId: number): boolean {
    if (this.recentMessageIds.has(messageId)) return true;
    this.recentMessageIds.add(messageId);
    this.recentMessageOrder.push(messageId);
    if (this.recentMessageOrder.length > 512) {
      const oldest = this.recentMessageOrder.shift();
      if (oldest !== undefined) this.recentMessageIds.delete(oldest);
    }
    return false;
  }

  private resetReadTimeout(socket: WebSocket, generation: number): void {
    if (this.readTimeoutTimer) clearTimeout(this.readTimeoutTimer);
    this.readTimeoutTimer = setTimeout(() => {
      if (!this.isCurrent(socket, generation)) return;
      logger.warn('WS 读超时，主动断开');
      socket.terminate();
    }, this.READ_TIMEOUT);
  }

  private scheduleStableRetryReset(socket: WebSocket, generation: number): void {
    if (this.stableConnectionTimer) clearTimeout(this.stableConnectionTimer);
    this.stableConnectionTimer = setTimeout(() => {
      if (!this.isCurrent(socket, generation) || this.status !== WS_STATUS.Connected) return;
      this.retryCount = 0;
      // 短暂 open 不代表链路已恢复；稳定满 60 秒后才终止断线降级窗口。
      this.stopPollingFallback();
      logger.debug('WS 稳定连接满 60 秒，重置退避次数');
    }, this.STABLE_CONNECTION_TIME);
  }

  private isCurrent(socket: WebSocket, generation: number): boolean {
    return this.ws === socket && this.generation === generation;
  }

  private invalidateCurrentSocket(terminate: boolean): void {
    const socket = this.ws;
    this.generation++;
    this.ws = null;
    this.cleanupConnectionTimers();
    if (!socket) return;
    if (terminate) socket.terminate();
    else socket.close();
  }

  private scheduleReconnect(): void {
    if (!this.shouldReconnect || this.status === WS_STATUS.Closing) return;

    if (this.networkOnline === false) {
      this.status = WS_STATUS.Offline;
      this.notifyStatusChange();
      return;
    }

    this.status = WS_STATUS.NotConnect;
    this.notifyStatusChange();

    // P0 修复：仅首次断连时启动降级轮询，避免重复创建定时器
    if (!this.disconnectSince) {
      this.disconnectSince = Date.now();
      this.startPollingFallback();
    }

    if (this.retryTimer) return;
    const baseDelay = this.RETRY_SECONDS[Math.min(this.retryCount, this.RETRY_SECONDS.length - 1)];
    this.retryCount++;
    const delay = Math.round(baseDelay * (0.8 + Math.random() * 0.4));
    logger.info(`WS 将在 ${delay}s 后重连 (连续失败 ${this.retryCount} 次)`);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (this.shouldReconnect) this.connect(this.pushToken);
    }, delay * 1000);
  }

  private async reportPushToken(pushToken: string): Promise<void> {
    // 未登录时跳过上报，pushToken 会在登录时通过 registerDevice 一起提交
    const credential = await CredentialManager.getCredential();
    if (!credential?.deviceToken) {
      logger.debug('未登录，跳过 pushToken 上报');
      return;
    }
    logger.debug(`开始上报 pushToken: ${pushToken.substring(0, 12)}...`);
    const delays = [5_000, 15_000, 45_000];
    for (let i = 0; i < 3; i++) {
      try {
        await ApiService.updateDeviceInfo({
          pushToken,
          // 服务端 update-device-info 依赖 deviceUuid 定位设备，缺失会返回 1001
          ...(credential.deviceUuid ? { deviceUuid: credential.deviceUuid } : {}),
          platform: getDesktopPlatform(),
        });
        logger.debug('pushToken 上报成功');
        return;
      } catch (err: any) {
        // code=1001 设备不存在：凭证已失效，无需重试，走登出并要求重新登录
        if (err?.code === 1001) {
          logger.warn('pushToken 上报失败: 设备不存在(code=1001)，执行登出并跳转登录页');
          await this.handleDeviceNotExist();
          return;
        }
        logger.warn(`pushToken 上报失败 (${i + 1}/3): code=${err?.code} msg=${err?.message}`);
        if (i < 2) await sleep(delays[i]);
      }
    }
    logger.warn('pushToken 上报失败，已达最大重试次数');
  }

  // 设备不存在(1001)：清除登录态（保留 deviceUuid 设备身份）、断开 WS、
  // 停止定时上报，并跳转登录页要求用户重新登录
  private async handleDeviceNotExist(): Promise<void> {
    this.stopPushTokenReportSchedule();
    await CredentialManager.clearCredential();
    this.disconnect();
    WindowManager.navigateToLogin();
  }

  handleNetworkOffline(): void {
    this.networkOnline = false;
    if (this.networkChangeTimer) {
      clearTimeout(this.networkChangeTimer);
      this.networkChangeTimer = null;
    }
    this.stopPollingFallback();
    this.invalidateCurrentSocket(true);

    if (this.status !== WS_STATUS.Offline) {
      logger.info('网络离线，WS 进入离线状态');
      this.status = WS_STATUS.Offline;
      this.notifyStatusChange();
    }
  }

  handleNetworkOnline(): void {
    this.networkOnline = true;
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }

    // 已连接 / 正在连接时不打断，避免初始化时主动评估和 WS 启动竞争 force reconnect。
    if (this.status === WS_STATUS.Connected || this.status === WS_STATUS.Connecting) {
      logger.info(`网络恢复，WS 当前状态=${this.status}，跳过强制重连`);
      return;
    }
    logger.info('网络恢复，WS 立即重连');
    if (this.shouldReconnect) this.connect(this.pushToken, true);
  }

  // 仍在线但网卡变化（换网/换 IP）：旧 socket 可能已绑在失效网卡上，
  // 必须强制重连（不走 handleNetworkOnline 在 Connected 时的跳过逻辑）。
  handleNetworkChanged(): void {
    this.networkOnline = true;
    if (this.networkChangeTimer) clearTimeout(this.networkChangeTimer);
    this.networkChangeTimer = setTimeout(() => {
      this.networkChangeTimer = null;
      if (!this.shouldReconnect) return;
      logger.info('网络变化稳定 2 秒，WS 强制重连');
      this.connect(this.pushToken, true);
    }, 2_000);
  }

  private startPollingFallback(): void {
    if (this.pollDelayTimer || this.pollTimer) return;
    this.pollDelayTimer = setTimeout(() => {
      this.pollDelayTimer = null;
      if (!this.disconnectSince) return;

      // 延迟到期时可能恰好处于一次尚未稳定的短连接中。轮询 timer 仍需保留，
      // 由 pollMessages 在 Connected 时自行跳过；否则该连接再次断开后将永远失去兜底。
      void this.pollMessages();
      this.pollTimer = setInterval(() => void this.pollMessages(), 60_000);
    }, 180_000);
  }

  private async pollMessages(): Promise<void> {
    if (this.pollInFlight || this.status === WS_STATUS.Connected || !this.disconnectSince) return;
    this.pollInFlight = true;
    try {
      const messages = await ApiService.getMessageList({
        messageId: Number.MAX_SAFE_INTEGER,
        key: '',
        scene: 2,
      });
      if (!this.isConnected() && this.disconnectSince) {
        WindowManager.sendToRenderer('ws:poll-messages', messages);
      }
    } catch (e) {
      logger.warn('降级轮询失败', e);
    } finally {
      this.pollInFlight = false;
    }
  }

  private stopPollingFallback(): void {
    if (this.pollDelayTimer) {
      clearTimeout(this.pollDelayTimer);
      this.pollDelayTimer = null;
    }
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.pollInFlight = false;
    this.disconnectSince = null;
  }

  disconnect(): void {
    this.shouldReconnect = false;
    this.status = WS_STATUS.Closing;
    this.stopPollingFallback();
    this.invalidateCurrentSocket(false);
    this.status = WS_STATUS.NotConnect;
    this.notifyStatusChange();
  }

  private cleanupConnectionTimers(): void {
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
    if (this.stableConnectionTimer) {
      clearTimeout(this.stableConnectionTimer);
      this.stableConnectionTimer = null;
    }
  }

  private notifyStatusChange(): void {
    WindowManager.sendToRenderer('ws:status', this.status);
  }

  getStatus(): WsStatusValue {
    return this.status;
  }

  isConnected(): boolean {
    return this.status === WS_STATUS.Connected;
  }

  getPushToken(): string | null {
    return this.pushToken;
  }

  hasPushToken(): boolean {
    return !!this.pushToken;
  }

  // 登录成功后调用，上报 pushToken 到服务端
  async reportPushTokenIfNeeded(): Promise<void> {
    if (this.pushToken) {
      await this.reportPushToken(this.pushToken);
    }
  }

  // 兜底定时任务：每 1h 主动上报一次 pushToken（登录态由 reportPushToken 内部自检，
  // 未登录自动跳过）。幂等，重复调用不会创建多个定时器。不立即触发，
  // 登录 / DEVICE_INIT 已各自上报过，等满间隔才首报。
  startPushTokenReportSchedule(): void {
    if (this.pushTokenReportTimer) return;
    this.pushTokenReportTimer = setInterval(() => {
      if (this.pushToken) {
        this.reportPushToken(this.pushToken);
      }
    }, this.PUSH_TOKEN_REPORT_INTERVAL);
  }

  stopPushTokenReportSchedule(): void {
    if (this.pushTokenReportTimer) {
      clearInterval(this.pushTokenReportTimer);
      this.pushTokenReportTimer = null;
    }
  }
}

export const WsManager = new WsManagerClass();
