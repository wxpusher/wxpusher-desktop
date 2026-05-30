import { ApiService } from './ApiService';
import { CredentialManager } from './CredentialManager';
import { PreferencesManager } from './PreferencesManager';
import { WindowManager } from './WindowManager';
import { IPC_CHANNELS } from '../ipc/ipcChannels';
import { logger } from '../utils/logger';
import type { CheckAppMsgReason, PushCheckOutcome } from '../../src/types';

// 主窗口 show 触发推送检查的最小间隔；设置页按钮可强制触发，绕过此节流。
const THROTTLE_MS = 60 * 60 * 1000;

export class PushCheckManager {
  // 同一时刻只允许一个真实请求在飞行；并发调用共享同一个 Promise。
  private static inflight: Promise<PushCheckOutcome> | null = null;
  // 进程级标志：本次启动是否已完整跑过一次真实请求；用于让 app 重启绕过 1h 节流
  private static firstRunDone = false;

  static async run(opts: { force: boolean }): Promise<PushCheckOutcome> {
    if (this.inflight) return this.inflight;

    // 冷启动后第一次实际请求强制绕过节流；持久化节流戳只对「同一进程内的后续 show」生效
    const effectiveForce = opts.force || !this.firstRunDone;
    const lastAt = PreferencesManager.get('checkReasonThrottleAt');
    const lastResult = PreferencesManager.get('pushCheckLastResult');
    if (!effectiveForce && Date.now() - lastAt < THROTTLE_MS) {
      logger.info('PushCheck 命中节流缓存，跳过请求');
      return { status: 'ok', result: lastResult };
    }

    logger.debug(`PushCheck 开始：force=${opts.force} effectiveForce=${effectiveForce}`);
    this.inflight = (async (): Promise<PushCheckOutcome> => {
      const cred = await CredentialManager.getCredential();
      // 未登录：不落盘、不广播，也不消费 firstRunDone（等登录后再算「首次」）
      if (!cred?.deviceToken) {
        logger.debug('PushCheck 跳过：未登录（无 deviceToken），不发起检查');
        return { status: 'not-logged-in' };
      }
      // 进入真实请求阶段就视为已完成首次跑动，后续 show 受节流约束
      this.firstRunDone = true;
      try {
        const result = (await ApiService.checkNoMsg()) as CheckAppMsgReason | null;
        PreferencesManager.set('checkReasonThrottleAt', Date.now());
        PreferencesManager.set('pushCheckLastResult', result ?? null);
        WindowManager.sendToRenderer(IPC_CHANNELS.MSG_PUSH_CHECK_RESULT, result ?? null);
        return { status: 'ok', result: result ?? null };
      } catch (e) {
        // 网络/抛错：把结果落 null（避免误把传输错误当成服务端 reason），
        // 但仍 bump 节流戳，防止离线时连续 show 触发请求风暴
        logger.warn(`PushCheck 失败: ${(e as Error).message}`);
        PreferencesManager.set('checkReasonThrottleAt', Date.now());
        PreferencesManager.set('pushCheckLastResult', null);
        WindowManager.sendToRenderer(IPC_CHANNELS.MSG_PUSH_CHECK_RESULT, null);
        return { status: 'error' };
      } finally {
        this.inflight = null;
      }
    })();
    return this.inflight;
  }

  static onWindowShown(): void {
    this.run({ force: false }).catch(() => {});
  }

  static getLast(): { lastAt: number; lastResult: CheckAppMsgReason | null } {
    return {
      lastAt: PreferencesManager.get('checkReasonThrottleAt'),
      lastResult: PreferencesManager.get('pushCheckLastResult'),
    };
  }

  static clear(): void {
    PreferencesManager.set('checkReasonThrottleAt', 0);
    PreferencesManager.set('pushCheckLastResult', null);
    // 退出登录后若同会话再次登录，也需要按「首次」绕过节流跑一次
    this.firstRunDone = false;
    WindowManager.sendToRenderer(IPC_CHANNELS.MSG_PUSH_CHECK_RESULT, null);
  }
}
