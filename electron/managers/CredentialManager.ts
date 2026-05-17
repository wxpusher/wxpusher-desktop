import { safeStorage, app } from 'electron'; // app is used in getMachineId fallback
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execSync } from 'child_process';
import { logger } from '../utils/logger';

export interface CredentialData {
  deviceToken?: string;
  deviceUuid?: string;
  pushToken?: string;
}

export class CredentialManager {
  private static getCredentialPath(): string {
    return path.join(app.getPath('userData'), 'credentials.enc');
  }

  private static cachedMachineId: string | null = null;

  // P0 修复：缓存 machineId，避免随机值导致凭证无法解密
  private static async getMachineId(): Promise<string> {
    if (this.cachedMachineId) return this.cachedMachineId;

    try {
      switch (process.platform) {
        case 'darwin':
          this.cachedMachineId = execSync(
            "ioreg -rd1 -c IOPlatformExpertDevice | grep IOPlatformUUID | awk -F'\"' '{print $4}'"
          )
            .toString()
            .trim();
          break;
        case 'win32': {
          const output = execSync(
            'REG QUERY HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Cryptography /v MachineGuid'
          ).toString();
          const match = output.match(/MachineGuid\s+REG_SZ\s+([a-f0-9-]+)/i);
          if (!match) throw new Error('无法读取 MachineGuid');
          this.cachedMachineId = match[1];
          break;
        }
        default:
          this.cachedMachineId = fs.readFileSync('/etc/machine-id', 'utf8').trim();
          break;
      }
    } catch (e) {
      logger.warn('获取 machine-id 失败，使用基于 userData 的稳定值', e);
      // P0 修复：使用 userData 路径的 hash 作为稳定降级值，而非随机值
      const userDataPath = app.getPath('userData');
      this.cachedMachineId = crypto.createHash('sha256').update(userDataPath).digest('hex');
    }

    return this.cachedMachineId!;
  }

  static async saveCredential(data: CredentialData): Promise<void> {
    try {
      const filePath = this.getCredentialPath();
      if (safeStorage.isEncryptionAvailable()) {
        const encrypted = safeStorage.encryptString(JSON.stringify(data));
        fs.writeFileSync(filePath, encrypted);
      } else {
        // 降级：machine-id + PBKDF2 派生密钥
        const machineId = await this.getMachineId();
        const salt = crypto.randomBytes(16);
        const key = crypto.pbkdf2Sync(machineId, salt, 100000, 32, 'sha512');
        const iv = crypto.randomBytes(16);
        const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
        const plaintext = Buffer.from(JSON.stringify(data), 'utf8');
        const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
        const authTag = cipher.getAuthTag();
        const payload = Buffer.concat([salt, iv, authTag, encrypted]);
        fs.writeFileSync(filePath, payload);
      }
      logger.info('凭证已保存');
    } catch (e) {
      logger.error('保存凭证失败', e);
      throw e;
    }
  }

  static async getCredential(): Promise<CredentialData | null> {
    try {
      const filePath = this.getCredentialPath();
      if (!fs.existsSync(filePath)) {
        logger.info('凭证文件不存在');
        return null;
      }
      const encrypted = fs.readFileSync(filePath);
      if (safeStorage.isEncryptionAvailable()) {
        const decrypted = safeStorage.decryptString(encrypted);
        const cred = JSON.parse(decrypted) as CredentialData;
        logger.info(`凭证读取成功: deviceToken=${cred.deviceToken?.substring(0, 8)}... pushToken=${cred.pushToken?.substring(0, 8) || 'null'}`);
        return cred;
      }
      return await this.decryptFromFile(encrypted);
    } catch (err) {
      logger.error('凭证读取/解密失败:', err);
      return null;
    }
  }

  private static async decryptFromFile(data: Buffer): Promise<CredentialData | null> {
    try {
      const machineId = await this.getMachineId();
      const salt = data.subarray(0, 16);
      const iv = data.subarray(16, 32);
      const authTag = data.subarray(32, 48);
      const encrypted = data.subarray(48);
      const key = crypto.pbkdf2Sync(machineId, salt, 100000, 32, 'sha512');
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(authTag);
      const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
      return JSON.parse(decrypted.toString('utf8'));
    } catch {
      return null;
    }
  }

  // 持久化 pushToken（不依赖登录）：合并写入，不覆盖已有 deviceToken/deviceUuid
  static async savePushToken(pushToken: string): Promise<void> {
    const existing = await this.getCredential();
    if (existing?.pushToken === pushToken) return; // 去重，避免重复加密写盘
    await this.saveCredential({ ...(existing ?? {}), pushToken });
  }

  static async clearCredential(): Promise<void> {
    try {
      // deviceUuid 是设备身份，永久不变：登出/失效时仅清除 deviceToken/pushToken，
      // 保留 deviceUuid，下次登录据此让服务端复用同一设备
      const existing = await this.getCredential();
      if (existing?.deviceUuid) {
        await this.saveCredential({ deviceUuid: existing.deviceUuid });
        logger.info('凭证已清除（保留 deviceUuid）');
        return;
      }
      const filePath = this.getCredentialPath();
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      logger.info('凭证已清除');
    } catch (e) {
      logger.error('清除凭证失败', e);
    }
  }
}
