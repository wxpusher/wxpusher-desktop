import { ipcMain } from 'electron';
import os from 'os';
import { IPC_CHANNELS } from '../ipc/ipcChannels';
import { WindowManager } from './WindowManager';
import { WsManager } from './WsManager';
import { createNetworkChangeSource, NetworkChangeSource } from './network/NetworkChangeSource';
import { logger } from '../utils/logger';

type NetworkStatus = 'online' | 'offline' | 'unknown';

class NetworkManagerClass {
  private status: NetworkStatus = 'unknown';
  private initialized = false;
  private evaluating = false;
  private pendingEvaluate = false;
  private lastSignature = '';
  private source: NetworkChangeSource | null = null;

  init(): void {
    if (this.initialized) return;
    this.initialized = true;

    logger.info('[NetworkManager] init() start');

    // preload 顶层 IIFE 上报的调试日志，统一打到主进程 logger，方便排查 preload 是否正常加载
    ipcMain.on('debug:log', (_e, msg: string) => {
      logger.debug(`[debug] ${msg}`);
    });

    // 感知「网络可能变化」的平台差异收敛在 NetworkChangeSource：
    // - 三平台都订阅 Chromium 事件（online/offline/connection-change）+ powerMonitor resume；
    // - 都保留轮询兜底，仅频率按平台区分（Linux 较高频，Mac/Win 稀疏）。
    // 是否在线仍由本机过滤后的活跃网卡签名判定（不请求 baseUrl）。
    this.source = createNetworkChangeSource();
    this.source.start({
      onReevaluate: (reason) => this.checkNow(reason),
      onForceOffline: (reason) => this.applyStatus('offline', '', reason),
    });

    this.dumpAllInterfacesRaw('init');

    try {
      this.evaluateAndApply('init');
    } catch (err) {
      logger.warn('[NetworkManager] 网络状态评估失败(init):', err);
    }

    logger.info('[NetworkManager] init() done.');
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
      logger.debug(`[NetworkManager] evaluate skip(${source})，已有评估在进行，挂起 pending`);
      return;
    }
    this.evaluating = true;
    logger.debug(`[NetworkManager] evaluate start(${source})`);
    try {
      const t0 = Date.now();
      // 仅依据过滤后的活跃网卡签名；不探测 HTTP/WS。空签名=离线。
      const sig = this.computeInterfaceSignature();
      const online = sig !== '';
      if (online) {
        logger.debug(`[NetworkManager] detectOnline: 有活跃网卡，判在线 signature=[${sig}]`);
      } else {
        logger.debug('[NetworkManager] detectOnline: 无活跃网卡，判离线');
      }
      logger.debug(`[NetworkManager] evaluate done(${source}): online=${online}, 耗时=${Date.now() - t0}ms`);
      this.applyStatus(online ? 'online' : 'offline', sig, source);
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

  private applyStatus(nextStatus: NetworkStatus, sig: string, source: string): void {
    const statusChanged = nextStatus !== this.status;
    const sigChanged = sig !== this.lastSignature;
    const prevSig = this.lastSignature;
    this.lastSignature = sig;

    if (!statusChanged) {
      // 仍在线但活跃网卡签名变化（换网/换 IP，如 WiFi 切以太网）：
      // status 未跃迁会被去重，但旧 socket 已绑在失效网卡上，需立即强制重连。
      if (nextStatus === 'online' && sigChanged && sig !== '') {
        logger.info(
          `[NetworkManager] 网卡签名变化(${source})，仍在线，强制 WS 重连: [${prevSig}] -> [${sig}]`
        );
        WsManager.handleNetworkChanged();
        return;
      }
      logger.debug(`[NetworkManager] 状态未变更(${source}): ${nextStatus}`);
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
}

export const NetworkManager = new NetworkManagerClass();
