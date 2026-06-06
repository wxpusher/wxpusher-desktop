import { app } from 'electron';
import { autoUpdater } from 'electron-updater';
import { ApiService } from './ApiService';
import { WindowManager } from './WindowManager';
import { IPC_CHANNELS } from '../ipc/ipcChannels';
import { getAppVersion } from '../utils/platform';
import { logger } from '../utils/logger';

/**
 * 后端 /api/device/version-update 的响应（AppVersionCheckResp，桌面端字段）。
 */
interface VersionCheckResp {
  hasUpdate: boolean;
  forceUpdate: boolean;
  title?: string;
  content?: string;
  latestVersion?: string;
  downloadUrl?: string;
}

export type UpdateSource = 'silent' | 'manual';
export type UpdatePhase =
  | 'checking'
  | 'no-update'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'error';

export interface UpdateStatusPayload {
  phase: UpdatePhase;
  source: UpdateSource;
  currentVersion: string;
  /** 后端返回的友好文案，仅用于 UI 展示 */
  title?: string;
  content?: string;
  latestVersion?: string;
  /** 是否强制升级（阻塞弹窗，不可关闭） */
  forceUpdate?: boolean;
  /** downloading 阶段的下载百分比（0-100） */
  percent?: number;
  /** error 阶段的错误信息 */
  message?: string;
  /** dev 环境：electron-updater 不可用，仅接口信息驱动 UI */
  dev?: boolean;
}

/**
 * 桌面端更新管理器。
 *
 * 严格串行，后端接口 /api/device/version-update 是唯一总闸：
 *   1. 任何时机都先查接口；
 *   2. hasUpdate=false → 结束，不触碰 electron-updater；
 *   3. hasUpdate=true → 用接口返回的 downloadUrl 作为 electron-updater 的 feed，
 *      再让它校验 feed 下的 latest-*.yml / 产物；
 *   4. silent 源后台自动下载、仅 downloaded 提示；manual 源等用户确认再下载。
 *
 * electron-updater 仅在打包后可用（dev 抛错），dev 下降级为仅接口信息驱动 UI。
 */
class UpdateManagerClass {
  private listenersBound = false;
  private currentSource: UpdateSource = 'silent';
  private lastResp: VersionCheckResp | null = null;
  private checkTimer: ReturnType<typeof setInterval> | null = null;

  // 后台单例下载状态机：保证全局只有一个下载实例，并支撑手动复检短路
  private checking = false; // 防并发 checkForUpdates
  private downloading = false; // 正在下载
  private downloaded = false; // 已下载完成（待重启安装）
  private downloadedVersion: string | null = null; // 已下载完成的版本号
  private latestPercent = 0; // 最近一次下载进度
  private lastCheckAt = 0; // 最近一次真正发起检查的时间戳（供窗口 show 触发节流）

  /** 启动 10s 后首检，之后每 1h 静默检查一次 */
  private static readonly FIRST_CHECK_DELAY = 10 * 1000;
  private static readonly CHECK_INTERVAL = 60 * 60 * 1000;
  /** 主窗口 show 触发检查的最小间隔：避免托盘/Dock 反复开关时频繁打后端 */
  private static readonly SHOW_CHECK_THROTTLE = 10 * 60 * 1000;

  init(): void {
    autoUpdater.autoInstallOnAppQuit = true;
    // 统一后台单例下载：只要检测到新版即自动下载，下载实例由 electron-updater 内部 + 本类状态机双重去重
    autoUpdater.autoDownload = true;
    autoUpdater.logger = logger;
    this.bindListeners();

    setTimeout(() => {
      this.checkForUpdates('silent').catch((e) => logger.warn('首检失败:', e));
    }, UpdateManagerClass.FIRST_CHECK_DELAY);

    this.checkTimer = setInterval(() => {
      this.checkForUpdates('silent').catch((e) => logger.warn('定时检查失败:', e));
    }, UpdateManagerClass.CHECK_INTERVAL);
  }

  /**
   * 主窗口每次显示时触发一次静默检查（带节流）：覆盖冷启动、托盘、Dock、第二实例所有路径，
   * 让用户"开窗即检查"，比纯 1h 定时更容易撞上新版；命中已下载短路会重新广播 downloaded，
   * 顺带回填工具栏"新版本已就绪"常驻入口。
   */
  onWindowShown(): void {
    if (Date.now() - this.lastCheckAt < UpdateManagerClass.SHOW_CHECK_THROTTLE) return;
    this.checkForUpdates('silent').catch((e) => logger.warn('窗口显示触发检查失败:', e));
  }

  /**
   * 检查更新。先查后端接口（总闸），再按需走 electron-updater。
   * 返回值供"手动"调用方（设置页"检查更新"按钮）即时展示结果。
   */
  async checkForUpdates(source: UpdateSource): Promise<UpdateStatusPayload> {
    this.currentSource = source;
    const currentVersion = getAppVersion();

    // 并发判重（需求 5）：已有 check 在途 → 回显"检查中"，不重复触发接口/下载。
    // 关键：必须在任何 await 之前置位 checking，否则 silent 定时器与手动点击并发时，
    // 两者会在 await 接口期间双双越过判重，导致重复 setFeedURL + checkForUpdates。
    if (this.checking) {
      const payload: UpdateStatusPayload = { phase: 'checking', source, currentVersion };
      this.send(payload);
      return payload;
    }
    this.checking = true;
    // 记录"真正发起的一次检查"时间：供窗口 show 触发节流（定时/手动/show 共用同一时间线）
    this.lastCheckAt = Date.now();

    if (source === 'manual') {
      this.send({ phase: 'checking', source, currentVersion });
    }

    try {
      let resp: VersionCheckResp | null = null;
      try {
        resp = (await ApiService.getVersionUpdate()) as VersionCheckResp;
      } catch (e) {
        logger.warn('version-update 接口失败:', e);
      }

      // 总闸：接口说没更新，或接口失败 → 结束，不触碰 electron-updater
      if (!resp || !resp.hasUpdate) {
        const payload: UpdateStatusPayload = { phase: 'no-update', source, currentVersion };
        this.send(payload);
        return payload;
      }

      this.lastResp = resp;
      const info = {
        title: resp.title,
        content: resp.content,
        latestVersion: resp.latestVersion,
        forceUpdate: resp.forceUpdate,
      };

      // dev：electron-updater 不可用，仅用接口信息驱动 UI（弹窗/气泡）
      if (!app.isPackaged) {
        const payload: UpdateStatusPayload = {
          phase: 'available',
          source,
          currentVersion,
          dev: true,
          ...info,
        };
        this.send(payload);
        return payload;
      }

      // 版本号变化复位：接口最新版本与"已下载完成"的版本不一致（出了更新的版本）→ 旧版本作废，
      // 复位 downloaded 标志，否则短路 1 不命中、且 startDownload 会因 downloaded=true 拒绝下载新版本。
      if (this.downloaded && this.downloadedVersion !== resp.latestVersion) {
        this.downloaded = false;
        this.downloadedVersion = null;
      }

      // 短路 1（需求 4/5）：资源已在后台下载完成 → 直接提示重启，不再触碰 electron-updater
      if (this.downloaded && this.downloadedVersion === resp.latestVersion) {
        const payload: UpdateStatusPayload = { phase: 'downloaded', source, currentVersion, ...info };
        this.send(payload);
        return payload;
      }

      // 短路 2（需求 5）：已有下载在途 → 回显进度，不重启新一轮 check/download
      if (this.downloading) {
        const payload: UpdateStatusPayload = {
          phase: 'downloading',
          source,
          currentVersion,
          percent: this.latestPercent,
          ...info,
        };
        this.send(payload);
        return payload;
      }

      // 打包环境：用接口 downloadUrl 作为 feed，让 electron-updater 校验产物
      if (!resp.downloadUrl) {
        logger.warn('接口 hasUpdate=true 但缺 downloadUrl，无法走 electron-updater');
        const payload: UpdateStatusPayload = {
          phase: 'available',
          source,
          currentVersion,
          ...info,
        };
        this.send(payload);
        return payload;
      }

      try {
        // 统一后台单例下载：autoDownload 恒为 true，校验到新版后自动开始下载
        autoUpdater.setFeedURL({ provider: 'generic', url: resp.downloadUrl });
        await autoUpdater.checkForUpdates();
      } catch (e) {
        logger.warn('electron-updater 检查失败:', e);
        this.send({
          phase: 'error',
          source,
          currentVersion,
          message: e instanceof Error ? e.message : String(e),
          ...info,
        });
      }

      return {
        phase: 'available',
        source,
        currentVersion,
        ...info,
      };
    } finally {
      this.checking = false;
    }
  }

  /** 兜底触发下载（统一模型下 autoDownload 已自动下载，此处幂等防重复） */
  async startDownload(): Promise<void> {
    if (!app.isPackaged) return;
    if (this.downloaded || this.downloading) return;
    try {
      await autoUpdater.downloadUpdate();
    } catch (e) {
      logger.warn('下载更新失败:', e);
      this.send({
        phase: 'error',
        source: this.currentSource,
        currentVersion: getAppVersion(),
        message: e instanceof Error ? e.message : String(e),
        ...this.infoFromResp(),
      });
    }
  }

  /** 用户点"更新并重启"：退出并安装，强制安装后自动重启 */
  quitAndInstall(): void {
    if (!app.isPackaged) return;
    // 关键：放行 WindowManager 的 close 拦截（否则只会隐藏到托盘、不退出不重启）
    (app as unknown as { isQuitting: boolean }).isQuitting = true;
    // isSilent=false, isForceRunAfter=true → 安装完成后强制重启应用
    setImmediate(() => autoUpdater.quitAndInstall(false, true));
  }

  private infoFromResp() {
    return {
      title: this.lastResp?.title,
      content: this.lastResp?.content,
      latestVersion: this.lastResp?.latestVersion,
      forceUpdate: this.lastResp?.forceUpdate,
    };
  }

  private bindListeners(): void {
    if (this.listenersBound) return;
    this.listenersBound = true;

    autoUpdater.on('update-available', () => {
      this.send({
        phase: 'available',
        source: this.currentSource,
        currentVersion: getAppVersion(),
        ...this.infoFromResp(),
      });
    });

    autoUpdater.on('update-not-available', () => {
      this.send({
        phase: 'no-update',
        source: this.currentSource,
        currentVersion: getAppVersion(),
      });
    });

    autoUpdater.on('download-progress', (p) => {
      this.downloading = true;
      this.downloaded = false;
      this.latestPercent = Math.round(p.percent);
      this.send({
        phase: 'downloading',
        source: this.currentSource,
        currentVersion: getAppVersion(),
        percent: this.latestPercent,
        ...this.infoFromResp(),
      });
    });

    autoUpdater.on('update-downloaded', () => {
      this.downloading = false;
      this.downloaded = true;
      this.downloadedVersion = this.lastResp?.latestVersion ?? null;
      this.send({
        phase: 'downloaded',
        source: this.currentSource,
        currentVersion: getAppVersion(),
        ...this.infoFromResp(),
      });
    });

    autoUpdater.on('error', (err) => {
      logger.warn('autoUpdater error:', err);
      this.downloading = false;
      this.send({
        phase: 'error',
        source: this.currentSource,
        currentVersion: getAppVersion(),
        message: err instanceof Error ? err.message : String(err),
        ...this.infoFromResp(),
      });
    });
  }

  private send(payload: UpdateStatusPayload): void {
    WindowManager.sendToRenderer(IPC_CHANNELS.UPDATE_STATUS, payload);
  }
}

export const UpdateManager = new UpdateManagerClass();
