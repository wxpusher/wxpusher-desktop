import { ipcMain, powerMonitor } from 'electron';
import { IPC_CHANNELS } from '../../ipc/ipcChannels';
import { getDesktopPlatform } from '../../utils/platform';
import { logger } from '../../utils/logger';

/**
 * 网络变化的「触发源」：只负责感知「可能发生了网络变化」并回调，
 * 不负责判定在线/离线（判定仍在 NetworkManager 内，基于网卡签名）。
 *
 * 平台差异（如何感知变化）收敛在本文件：
 * - 三平台都订阅 Chromium 事件（renderer online/offline + connection change），
 *   在 Win/macOS 上 Chromium 本身就订阅了系统网络广播，可靠且即时。
 * - 三平台都保留一个轮询兜底，仅频率按平台区分：
 *   Linux 部分桌面 Chromium 不触发 online/offline，需较高频兜底；
 *   Mac/Win 事件可靠，兜底只作事件漏报的稀疏保险。
 */
export interface NetworkChangeHandlers {
  /** 触发一次网络状态重评估（由 NetworkManager 按网卡签名判定在线/离线）。 */
  onReevaluate(reason: string): void;
  /** Chromium 明确判离线时立即判离线，让 UI/WS 尽快反映。 */
  onForceOffline(reason: string): void;
}

abstract class BaseNetworkChangeSource {
  /** 轮询兜底间隔，子类按平台覆写。 */
  protected abstract readonly pollIntervalMs: number;

  private pollTimer: NodeJS.Timeout | null = null;
  private rendererStatusHandler: ((event: unknown, isOnline: boolean) => void) | null = null;
  private connectionChangeHandler: (() => void) | null = null;
  private resumeHandler: (() => void) | null = null;
  private started = false;

  start(handlers: NetworkChangeHandlers): void {
    if (this.started) return;
    this.started = true;

    // Chromium 网络事件：offline 立即判离线；online 仅作为触发重评估的信号
    // （是否在线由 NetworkManager 按过滤后的活跃网卡签名决定）。
    this.rendererStatusHandler = (_event: unknown, isOnline: boolean) => {
      logger.info(`[NetworkChangeSource] renderer 网络事件: ${isOnline ? 'online' : 'offline'}`);
      if (!isOnline) {
        handlers.onForceOffline('renderer-offline');
        return;
      }
      handlers.onReevaluate('renderer-online');
    };
    ipcMain.on(IPC_CHANNELS.NETWORK_RENDERER_STATUS_CHANGED, this.rendererStatusHandler);

    // Network Information API change：捕获「仍在线但换网/换 IP」。
    this.connectionChangeHandler = () => {
      logger.info('[NetworkChangeSource] renderer connection change');
      handlers.onReevaluate('renderer-connection-change');
    };
    ipcMain.on(IPC_CHANNELS.NETWORK_RENDERER_CONNECTION_CHANGED, this.connectionChangeHandler);

    this.resumeHandler = () => {
      logger.info('[NetworkChangeSource] 系统从休眠恢复，触发网络状态重新检测');
      handlers.onReevaluate('resume');
    };
    powerMonitor.on('resume', this.resumeHandler);

    this.pollTimer = setInterval(() => {
      handlers.onReevaluate('timer');
    }, this.pollIntervalMs);

    logger.info(
      `[NetworkChangeSource] started (${this.constructor.name}), pollInterval=${this.pollIntervalMs}ms`
    );
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;

    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.rendererStatusHandler) {
      ipcMain.removeListener(IPC_CHANNELS.NETWORK_RENDERER_STATUS_CHANGED, this.rendererStatusHandler);
      this.rendererStatusHandler = null;
    }
    if (this.connectionChangeHandler) {
      ipcMain.removeListener(
        IPC_CHANNELS.NETWORK_RENDERER_CONNECTION_CHANGED,
        this.connectionChangeHandler
      );
      this.connectionChangeHandler = null;
    }
    if (this.resumeHandler) {
      powerMonitor.removeListener('resume', this.resumeHandler);
      this.resumeHandler = null;
    }
  }
}

/** Linux：Chromium online/offline 不可靠，较高频网卡轮询兜底。 */
class LinuxNetworkChangeSource extends BaseNetworkChangeSource {
  protected readonly pollIntervalMs = 4_000;
}

/**
 * macOS / Windows：Chromium NetworkChangeNotifier 订阅系统网络广播，
 * 事件即时可靠，轮询仅作稀疏兜底。
 * （保留独立子类，便于未来按平台扩展原生监听等。）
 */
class EventDrivenNetworkChangeSource extends BaseNetworkChangeSource {
  protected readonly pollIntervalMs = 30_000;
}

export function createNetworkChangeSource(): BaseNetworkChangeSource {
  if (getDesktopPlatform() === 'desktop_linux') {
    return new LinuxNetworkChangeSource();
  }
  return new EventDrivenNetworkChangeSource();
}

export type NetworkChangeSource = BaseNetworkChangeSource;
