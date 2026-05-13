import { ipcMain, powerMonitor } from 'electron';
import os from 'os';
import { IPC_CHANNELS } from '../ipc/ipcChannels';
import { WindowManager } from './WindowManager';
import { WsManager } from './WsManager';
import { logger } from '../utils/logger';

type NetworkStatus = 'online' | 'offline' | 'unknown';

class NetworkManagerClass {
  private status: NetworkStatus = 'unknown';
  private initialized = false;
  private probeTimer: NodeJS.Timeout | null = null;
  private interfaceWatchTimer: NodeJS.Timeout | null = null;
  private evaluating = false;
  private pendingEvaluate = false;
  private lastInterfaceSignature = '';
  private readonly PROBE_INTERVAL_MS = 3_000;
  private readonly INTERFACE_WATCH_INTERVAL_MS = 1_000;

  init(): void {
    if (this.initialized) return;
    this.initialized = true;

    logger.info('[NetworkManager] init() start');

    // preload 顶层 IIFE 上报的调试日志，统一打到主进程 logger，方便排查 preload 是否正常加载
    ipcMain.on('debug:log', (_e, msg: string) => {
      logger.info(`[debug] ${msg}`);
    });

    // 收到 renderer 网络事件后立即决策：
    // - offline：Chromium 认为离线时直接判离线（UI 尽快反映）。
    // - online：仅作为触发重新评估的信号；是否在线由本机过滤后的活跃网卡签名决定（不请求 baseUrl）。
    // 部分 Linux 桌面 Chromium 可能不触发 online/offline，因此仍有网卡轮询与定时兜底。
    ipcMain.on(IPC_CHANNELS.NETWORK_RENDERER_STATUS_CHANGED, (_event, isOnline: boolean) => {
      logger.info(`[NetworkManager] Renderer 网络事件: ${isOnline ? 'online' : 'offline'}`);
      if (!isOnline) {
        this.applyStatus('offline', 'renderer-event');
        return;
      }
      this.checkNow('renderer-event');
    });

    powerMonitor.on('resume', () => {
      logger.info('[NetworkManager] 系统从休眠恢复，触发网络状态重新检测');
      this.checkNow('resume');
    });

    // OS 级网卡变化监听：每秒计算一次活跃网卡 IP 签名，发生变化即触发评估。
    this.lastInterfaceSignature = this.computeInterfaceSignature();
    logger.info(`[NetworkManager] 初始网卡签名=[${this.lastInterfaceSignature}]`);
    this.dumpAllInterfacesRaw('init');
    this.interfaceWatchTimer = setInterval(() => {
      const sig = this.computeInterfaceSignature();
      if (sig !== this.lastInterfaceSignature) {
        const prev = this.lastInterfaceSignature;
        this.lastInterfaceSignature = sig;
        logger.info(`[NetworkManager] 网卡变化: prev=[${prev}] next=[${sig}]`);
        this.dumpAllInterfacesRaw('change');
        this.checkNow('interface-change');
      }
    }, this.INTERFACE_WATCH_INTERVAL_MS);

    this.probeTimer = setInterval(() => {
      try {
        this.evaluateAndApply('timer');
      } catch (err) {
        logger.warn('[NetworkManager] 网络状态评估失败(timer):', err);
      }
    }, this.PROBE_INTERVAL_MS);

    try {
      this.evaluateAndApply('init');
    } catch (err) {
      logger.warn('[NetworkManager] 网络状态评估失败(init):', err);
    }

    logger.info(
      `[NetworkManager] init() done. pollInterval=${this.PROBE_INTERVAL_MS}ms, ifaceWatch=${this.INTERFACE_WATCH_INTERVAL_MS}ms`
    );
  }

  // 计算过滤后的「活跃」网卡签名，跨平台兼容 Linux/macOS/Windows。
  // 规则：
  // 1) 跳过 internal。
  // 2) 跳过链路本地 / 伪公网段地址（169.254、fe80、198.18/19 等）。
  // 3) 跳过常见虚拟接口（Docker、Hyper-V、Clash TUN 等）。
  // 非空签名即视为本机具备可用于外联的网卡地址；WS 建连成败由 WsManager 自行处理。
  private computeInterfaceSignature(): string {
    const ifaces = os.networkInterfaces();
    const parts: string[] = [];
    for (const name of Object.keys(ifaces).sort()) {
      if (this.isVirtualInterfaceName(name)) continue;
      const list = ifaces[name];
      if (!list) continue;
      for (const info of list) {
        if (info.internal) continue;
        if (this.isLinkLocalAddress(info.family, info.address)) continue;
        parts.push(`${name}:${info.family}:${info.address}`);
      }
    }
    return parts.join('|');
  }

  private isVirtualInterfaceName(name: string): boolean {
    const lower = name.toLowerCase();
    // macOS
    if (/^awdl\d*$/.test(lower)) return true;
    if (/^llw\d*$/.test(lower)) return true;
    if (/^utun\d*$/.test(lower)) return true;
    if (/^anpi\d*$/.test(lower)) return true;
    if (/^ap\d+$/.test(lower)) return true;
    // Windows
    if (lower.startsWith('vethernet')) return true;
    if (lower.startsWith('loopback')) return true;
    if (lower.startsWith('teredo')) return true;
    if (lower.startsWith('isatap')) return true;
    if (lower.startsWith('bluetooth')) return true;
    // Linux
    if (/^docker\d*$/.test(lower)) return true;
    if (lower.startsWith('br-')) return true;
    if (/^veth/.test(lower)) return true;
    // 代理/翻墙工具 TUN 接口：Clash.Meta / mihomo / sing-box
    if (lower === 'meta' || lower === 'mihomo') return true;
    if (lower.startsWith('singbox') || lower.startsWith('sing-box')) return true;
    if (lower === 'tun0' || lower === 'tun1') return true;
    return false;
  }

  private dumpAllInterfacesRaw(tag: string): void {
    try {
      const ifaces = os.networkInterfaces();
      const summary: string[] = [];
      for (const name of Object.keys(ifaces).sort()) {
        const list = ifaces[name];
        if (!list) continue;
        for (const info of list) {
          const filteredByName = this.isVirtualInterfaceName(name);
          const filteredByAddr = this.isLinkLocalAddress(info.family, info.address);
          const filtered = info.internal || filteredByName || filteredByAddr;
          summary.push(
            `${name}/${info.family}/${info.address}${info.internal ? '/internal' : ''}${filteredByName ? '/virt' : ''}${filteredByAddr ? '/linklocal' : ''}${filtered ? ' [filtered]' : ' [active]'}`
          );
        }
      }
      logger.info(`[NetworkManager] interfaces dump(${tag}):\n  ${summary.join('\n  ')}`);
    } catch (e) {
      logger.warn(`[NetworkManager] dump interfaces 失败(${tag}):`, e);
    }
  }

  private isLinkLocalAddress(family: string, address: string): boolean {
    if (!address) return true;
    if (family === 'IPv4') {
      if (address.startsWith('169.254.')) return true;
      if (address.startsWith('198.18.') || address.startsWith('198.19.')) return true;
      return false;
    }
    const lower = address.toLowerCase();
    return lower.startsWith('fe80:') || lower.startsWith('fe80::');
  }

  getStatus(): NetworkStatus {
    return this.status;
  }

  checkNow(source: string): void {
    try {
      this.evaluateAndApply(source);
    } catch (err) {
      logger.warn(`[NetworkManager] 网络状态评估失败(${source}):`, err);
    }
  }

  private evaluateAndApply(source: string): void {
    if (this.evaluating) {
      this.pendingEvaluate = true;
      logger.info(`[NetworkManager] evaluate skip(${source})，已有评估在进行，挂起 pending`);
      return;
    }
    this.evaluating = true;
    logger.info(`[NetworkManager] evaluate start(${source})`);
    try {
      const t0 = Date.now();
      const online = this.detectOnline();
      logger.info(`[NetworkManager] evaluate done(${source}): online=${online}, 耗时=${Date.now() - t0}ms`);
      this.applyStatus(online ? 'online' : 'offline', source);
    } finally {
      this.evaluating = false;
      if (this.pendingEvaluate) {
        this.pendingEvaluate = false;
        try {
          this.evaluateAndApply(`${source}+pending`);
        } catch (err) {
          logger.warn(`[NetworkManager] 网络状态评估失败(${source}+pending):`, err);
        }
      }
    }
  }

  private applyStatus(nextStatus: NetworkStatus, source: string): void {
    if (nextStatus === this.status) {
      logger.info(`[NetworkManager] 状态未变更(${source}): ${nextStatus}`);
      return;
    }

    const prev = this.status;
    this.status = nextStatus;
    logger.info(`[NetworkManager] 网络状态变更(${source}): ${prev} -> ${nextStatus}`);
    WindowManager.sendToRenderer(IPC_CHANNELS.NETWORK_STATUS, nextStatus);

    if (nextStatus === 'online') {
      WsManager.handleNetworkOnline();
      return;
    }
    WsManager.handleNetworkOffline();
  }

  /** 仅依据过滤后的活跃网卡签名；不探测 HTTP/WS。 */
  private detectOnline(): boolean {
    const sig = this.computeInterfaceSignature();
    if (!sig) {
      logger.info('[NetworkManager] detectOnline: 无活跃网卡，判离线');
      return false;
    }
    logger.info(`[NetworkManager] detectOnline: 有活跃网卡，判在线（不探测 baseUrl） signature=[${sig}]`);
    return true;
  }
}

export const NetworkManager = new NetworkManagerClass();
