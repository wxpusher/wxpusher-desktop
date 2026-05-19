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

  /** 启动 10s 后首检，之后每 4h 静默检查一次 */
  private static readonly FIRST_CHECK_DELAY = 10 * 1000;
  private static readonly CHECK_INTERVAL = 4 * 60 * 60 * 1000;

  init(): void {
    autoUpdater.autoInstallOnAppQuit = true;
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
   * 检查更新。先查后端接口（总闸），再按需走 electron-updater。
   * 返回值供"手动"调用方（设置页"检查更新"按钮）即时展示结果。
   */
  async checkForUpdates(source: UpdateSource): Promise<UpdateStatusPayload> {
    this.currentSource = source;
    const currentVersion = getAppVersion();

    if (source === 'manual') {
      this.send({ phase: 'checking', source, currentVersion });
    }

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
      // silent 源后台自动下载；manual 源等用户在弹窗确认后再 downloadUpdate()
      autoUpdater.autoDownload = source === 'silent';
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
  }

  /** 手动流程：用户在弹窗点"立即更新"后触发下载 */
  async startDownload(): Promise<void> {
    if (!app.isPackaged) return;
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

  /** 用户点"更新并重启"：退出并安装 */
  quitAndInstall(): void {
    if (!app.isPackaged) return;
    autoUpdater.quitAndInstall();
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
      this.send({
        phase: 'downloading',
        source: this.currentSource,
        currentVersion: getAppVersion(),
        percent: Math.round(p.percent),
        ...this.infoFromResp(),
      });
    });

    autoUpdater.on('update-downloaded', () => {
      this.send({
        phase: 'downloaded',
        source: this.currentSource,
        currentVersion: getAppVersion(),
        ...this.infoFromResp(),
      });
    });

    autoUpdater.on('error', (err) => {
      logger.warn('autoUpdater error:', err);
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
