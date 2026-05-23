import { ApiService } from './ApiService';
import { CredentialManager } from './CredentialManager';
import { PreferencesManager } from './PreferencesManager';
import { WindowManager } from './WindowManager';
import { IPC_CHANNELS } from '../ipc/ipcChannels';
import { logger } from '../utils/logger';
import type { BannerData } from '../../src/types';

// 主窗口 show 触发公告拉取的最小间隔；与 PushCheck 节流对齐，避免冷启动/托盘/Dock 反复打后端。
const THROTTLE_MS = 60 * 60 * 1000;

export class AnnouncementBannerManager {
  // 同一时刻只允许一个真实请求在飞行；并发调用共享同一个 Promise。
  private static inflight: Promise<BannerData | null> | null = null;
  // 进程级标志：本次启动是否已完整跑过一次真实请求；用于让 app 重启绕过 1h 节流
  private static firstRunDone = false;

  static async run(opts: { force: boolean }): Promise<BannerData | null> {
    if (this.inflight) return this.inflight;

    // 冷启动后第一次实际请求强制绕过节流；持久化节流戳只对「同一进程内的后续 show」生效
    const effectiveForce = opts.force || !this.firstRunDone;
    const lastAt = PreferencesManager.get('bannerThrottleAt');
    const lastResult = PreferencesManager.get('bannerLastResult');
    if (!effectiveForce && Date.now() - lastAt < THROTTLE_MS) {
      return lastResult;
    }

    this.inflight = (async () => {
      const cred = await CredentialManager.getCredential();
      // 未登录：不落盘、不广播，也不消费 firstRunDone（等登录后再算「首次」）
      if (!cred?.deviceToken) return null;
      // 进入真实请求阶段就视为已完成首次跑动，后续 show 受节流约束
      this.firstRunDone = true;
      try {
        const result = (await ApiService.getListBanner()) as BannerData | null;
        PreferencesManager.set('bannerThrottleAt', Date.now());
        PreferencesManager.set('bannerLastResult', result ?? null);
        WindowManager.sendToRenderer(IPC_CHANNELS.MSG_LIST_BANNER_RESULT, result ?? null);
        return result ?? null;
      } catch (e) {
        // 网络/抛错：把结果落 null（避免把传输错误当成有效公告），
        // 但仍 bump 节流戳，防止离线时连续 show 触发请求风暴
        logger.warn(`ListBanner 失败: ${(e as Error).message}`);
        PreferencesManager.set('bannerThrottleAt', Date.now());
        PreferencesManager.set('bannerLastResult', null);
        WindowManager.sendToRenderer(IPC_CHANNELS.MSG_LIST_BANNER_RESULT, null);
        return null;
      } finally {
        this.inflight = null;
      }
    })();
    return this.inflight;
  }

  static onWindowShown(): void {
    this.run({ force: false }).catch(() => {});
  }

  static getLast(): { lastAt: number; lastResult: BannerData | null } {
    return {
      lastAt: PreferencesManager.get('bannerThrottleAt'),
      lastResult: PreferencesManager.get('bannerLastResult'),
    };
  }

  static clear(): void {
    PreferencesManager.set('bannerThrottleAt', 0);
    PreferencesManager.set('bannerLastResult', null);
    // 关闭记录也一并重置：换账户后应能重新看到此前在本设备上关掉过的公告
    PreferencesManager.set('closedBannerId', null);
    // 退出登录后若同会话再次登录，也需要按「首次」绕过节流跑一次
    this.firstRunDone = false;
    WindowManager.sendToRenderer(IPC_CHANNELS.MSG_LIST_BANNER_RESULT, null);
  }
}
