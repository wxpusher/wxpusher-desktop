import { net } from 'electron';
import { CredentialManager } from './CredentialManager';
import { PreferencesManager } from './PreferencesManager';
import { WindowManager } from './WindowManager';
import { WsManager } from './WsManager';
import { getDesktopPlatform, getAppVersion } from '../utils/platform';
import { logger } from '../utils/logger';

interface ApiResponse<T> {
  code: number;
  msg: string;
  data: T;
}

class ApiError extends Error {
  code: number;
  constructor(code: number, msg: string) {
    super(msg);
    this.code = code;
  }
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    result.push(arr.slice(i, i + size));
  }
  return result;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 日志里打印 body 时做长度截断，避免消息列表等大响应撑爆日志文件
function truncate(value: unknown, max = 2000): string {
  let str: string;
  try {
    str = typeof value === 'string' ? value : JSON.stringify(value);
  } catch {
    str = String(value);
  }
  if (str == null) return '';
  return str.length > max ? `${str.slice(0, max)}…(${str.length} chars)` : str;
}

export class ApiService {
  static async request<T>(options: {
    method: string;
    path: string;
    body?: any;
    headers?: Record<string, string>;
  }): Promise<T> {
    const config = PreferencesManager.getConfig();
    const credential = await CredentialManager.getCredential();
    const url = `${config.baseUrl}${options.path}`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json;charset=utf-8',
      version: getAppVersion(),
      platform: getDesktopPlatform(),
      ...options.headers,
    };
    if (credential?.deviceToken) {
      headers['deviceToken'] = credential.deviceToken;
    }

    const start = Date.now();
    // 每个请求都打「开始」行（含无 body 的 GET，如 no-msg-check），与响应/失败行成对，便于排查
    logger.info(
      `[API] -> ${options.method} ${options.path}` +
        (options.body !== undefined ? ` req=${truncate(options.body)}` : '')
    );
    try {
      const response = await fetch(url, {
        method: options.method,
        headers,
        body: options.body ? JSON.stringify(options.body) : undefined,
      });

      const result: ApiResponse<T> = await response.json();
      const cost = Date.now() - start;
      logger.info(
        `[API] ${options.method} ${options.path} http=${response.status} code=${result.code} ${cost}ms resp=${truncate(result)}`
      );

      if (result.code === 1000) return result.data;
      if (result.code === 1002) {
        await CredentialManager.clearCredential();
        WsManager.disconnect();
        WindowManager.sendToRenderer('auth:expired');
        throw new ApiError(1002, '认证已过期');
      }
      throw new ApiError(result.code, result.msg);
    } catch (e: any) {
      // 业务错误（已记日志/会被上层处理）直接透传，仅记录网络层异常
      if (!(e instanceof ApiError)) {
        const cost = Date.now() - start;
        logger.error(`[API] ${options.method} ${options.path} FAILED ${cost}ms: ${e?.message || e}`);
      }
      throw e;
    }
  }

  // 登录相关
  static async createLoginQrcode(): Promise<{ code: string; expires: number }> {
    return this.request({ method: 'GET', path: '/api/device/create-login-qrcode' });
  }

  static async registerDevice(params: {
    code: string;
    deviceUuid?: string;
    deviceName: string;
    pushToken?: string;
    platform: string;
  }): Promise<{ deviceUuid: string; deviceToken: string }> {
    return this.request({ method: 'POST', path: '/api/device/register-device', body: params });
  }

  // 消息相关
  static async getMessageList(params: {
    messageId?: number;
    key?: string;
    scene: number;
  }): Promise<any[]> {
    const query = new URLSearchParams();
    if (params.messageId) query.set('messageId', String(params.messageId));
    if (params.key) query.set('key', params.key);
    query.set('scene', String(params.scene));
    const path = `/api/need-login/device/message/list-v2?${query}`;
    return this.request({ method: 'GET', path });
  }

  static async markRead(messageIds: number[], read: boolean): Promise<void> {
    return this.request({
      method: 'PUT',
      path: `/api/need-login/device/message/read-mark?messageIds=${messageIds.join(',')}&read=${read}`,
    });
  }

  static async deleteMessages(messageIds: number[]): Promise<void> {
    return this.request({
      method: 'DELETE',
      path: `/api/need-login/device/message/delete?messageIds=${messageIds.join(',')}`,
    });
  }

  static async deleteAllMessages(): Promise<void> {
    return this.request({ method: 'DELETE', path: '/api/need-login/device/message/delete-all' });
  }

  // 批量操作（分片）
  static async batchMarkRead(ids: number[], read: boolean): Promise<void> {
    const chunks = chunkArray(ids, 200);
    for (let i = 0; i < chunks.length; i++) {
      if (i > 0) await sleep(200);
      await this.markRead(chunks[i], read);
    }
  }

  static async batchDelete(ids: number[]): Promise<{ success: number; failed: number }> {
    const chunks = chunkArray(ids, 200);
    let success = 0;
    for (let i = 0; i < chunks.length; i++) {
      if (i > 0) await sleep(200);
      try {
        await this.deleteMessages(chunks[i]);
        success += chunks[i].length;
      } catch {
        return { success, failed: ids.length - success };
      }
    }
    return { success, failed: 0 };
  }

  // 设备相关
  static async logout(): Promise<void> {
    return this.request({ method: 'POST', path: '/api/need-login/device/logout' });
  }

  static async getOpenId(): Promise<string> {
    return this.request({ method: 'GET', path: '/api/need-login/device/openid' });
  }

  static async getUserDeviceInfo(): Promise<any> {
    return this.request({ method: 'GET', path: '/api/need-login/device/get-user-device-info' });
  }

  static async updateDeviceInfo(params: {
    pushToken?: string;
    deviceUuid?: string;
    platform?: string;
  }): Promise<void> {
    return this.request({
      method: 'PUT',
      path: '/api/need-login/device/update-device-info',
      body: params,
    });
  }

  static async checkNoMsg(): Promise<any> {
    return this.request({ method: 'GET', path: '/api/need-login/device/no-msg-check' });
  }

  static async getListBanner(): Promise<any> {
    return this.request({ method: 'GET', path: '/api/need-login/device/list-banner' });
  }

  static async getVersionUpdate(): Promise<any> {
    return this.request({ method: 'GET', path: '/api/device/version-update' });
  }

  static async loginPing(): Promise<boolean> {
    try {
      const config = PreferencesManager.getConfig();
      const response = await fetch(`${config.baseUrl}/api/device/login-ping`);
      return response.ok;
    } catch {
      return false;
    }
  }
}
