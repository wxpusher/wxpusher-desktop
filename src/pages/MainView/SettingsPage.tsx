import { useState, useEffect, useCallback } from 'react';
import { Switch, Radio, Input, App } from 'antd';
import {
  FolderOpen,
  ExternalLink,
} from 'lucide-react';
import { useAppStore } from '../../stores/appStore';
import type { NotifyPermissionState } from '../../types';

interface DesktopPrefs {
  notificationMode: string;
  launchShowMainWindow: boolean;
  [key: string]: unknown;
}

// 与 Android TestPanelActivity 对齐的环境常量
const ENV_PROD = {
  baseUrl: 'https://wxpusher.zjiecode.com',
  appFeUrl: 'https://wxpusher.zjiecode.com',
  wsUrl: 'wss://wxpusher.zjiecode.com',
};
const ENV_TEST = {
  baseUrl: 'http://wxpusher.test.zjiecode.com',
  appFeUrl: 'http://wxpusher.test.zjiecode.com',
  wsUrl: 'ws://wxpusher.test.zjiecode.com',
};

type EnvChoice = 'prod' | 'test' | 'custom';

function matchEnvChoice(current: string, prod: string, test: string): EnvChoice {
  if (current === prod) return 'prod';
  if (current === test) return 'test';
  return 'custom';
}

export default function SettingsPage() {
  const { message, modal } = App.useApp();
  const loginInfo = useAppStore((s) => s.loginInfo);
  const [prefs, setPrefs] = useState<DesktopPrefs | null>(null);
  const [notifPermission, setNotifPermission] = useState<NotifyPermissionState>({
    supported: true,
    granted: true,
    guide: 'none',
    canOpenSettings: false,
  });
  const [autoLaunch, setAutoLaunch] = useState(false);
  const [dataPath, setDataPath] = useState('');
  const [platform, setPlatform] = useState('');
  const [isDev, setIsDev] = useState(false);
  const [appVersion, setAppVersion] = useState('');
  const [checkingUpdate, setCheckingUpdate] = useState(false);

  // 环境配置状态（开发者选项）
  const [envConfig, setEnvConfig] = useState<{ baseUrl: string; wsUrl: string; appFeUrl: string } | null>(null);
  const [baseUrlChoice, setBaseUrlChoice] = useState<EnvChoice>('prod');
  const [wsUrlChoice, setWsUrlChoice] = useState<EnvChoice>('prod');
  const [appFeUrlChoice, setAppFeUrlChoice] = useState<EnvChoice>('prod');
  const [customBaseUrl, setCustomBaseUrl] = useState('');
  const [customWsUrl, setCustomWsUrl] = useState('');
  const [customAppFeUrl, setCustomAppFeUrl] = useState('');

  useEffect(() => {
    loadPrefs();
    window.electronAPI.checkNotificationPermission().then(setNotifPermission);
    window.electronAPI.getAutoLaunch().then(setAutoLaunch);
    window.electronAPI.getDataPath().then(setDataPath);
    window.electronAPI.getPlatform().then((p) => {
      const label = { darwin: 'Mac', win32: 'Windows', linux: 'Linux' }[p] || p;
      setPlatform(label);
    });
    window.electronAPI.getAppVersion().then(setAppVersion);
    // 判断是否为开发模式（非打包状态）
    window.electronAPI.isPackaged().then((packaged) => {
      const isDevMode = !packaged;
      setIsDev(isDevMode);
      if (isDevMode) {
        loadEnvConfig();
      }
    });
  }, []);

  // 焦点回来时重新检查通知权限
  useEffect(() => {
    const check = () => {
      window.electronAPI.checkNotificationPermission().then(setNotifPermission);
    };
    window.addEventListener('focus', check);
    return () => window.removeEventListener('focus', check);
  }, []);

  // 托盘菜单切换「通知行为」时同步设置页选项
  useEffect(() => {
    return window.electronAPI.onNotificationModeChanged((mode) => {
      setPrefs((prev: any) => (prev ? { ...prev, notificationMode: mode } : prev));
    });
  }, []);

  const loadPrefs = async () => {
    const allPrefs = await window.electronAPI.getAllPrefs();
    setPrefs(allPrefs);
  };

  const updatePref = async (key: string, value: any) => {
    await window.electronAPI.setPref(key, value);
    setPrefs((prev: any) => ({ ...prev, [key]: value }));
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    message.success('已复制');
  };

  const handleRecheckNotification = useCallback(async () => {
    const result = await window.electronAPI.checkNotificationPermission();
    setNotifPermission(result);
    if (!result.supported) {
      message.warning('当前系统不支持系统通知');
    } else if (result.granted) {
      message.success('系统通知权限已授权，无需重复开启');
    } else if (result.guide === 'manual') {
      modal.warning({
        title: '通知权限未开启',
        content: '仍未获得系统通知权限，请在系统的「通知」设置中允许 WxPusher 发送通知。',
        okText: '我知道了',
      });
    } else {
      modal.confirm({
        title: '通知权限未开启',
        content: '仍未获得系统通知权限，桌面提醒将无法弹出。',
        cancelText: '取消',
        okText: '去开启',
        onOk: () => {
          window.electronAPI.openNotificationSettings();
        },
      });
    }
  }, [message, modal]);

  const [pushChecking, setPushChecking] = useState(false);
  const handleRecheckPush = useCallback(async () => {
    setPushChecking(true);
    try {
      const result = await window.electronAPI.checkNoMsg();
      if (!result) {
        message.error('推送检查失败，请稍后重试', 5);
        return;
      }
      // code === 0 表示状态正常，无异常时只用 toast 提示
      if (result.code === 0) {
        message.success(result.reason || '推送状态正常');
        return;
      }
      // 存在异常时弹窗说明（须用 App.useApp 的 modal，静态 Modal 不继承暗色主题）
      modal.warning({
        title: '推送检查',
        content: result.reason || '推送状态异常',
        okText: '我知道了',
      });
    } finally {
      setPushChecking(false);
    }
  }, [message, modal]);

  const handleLogout = useCallback(() => {
    modal.confirm({
      title: '退出登录',
      content: '退出后将清除本地登录凭证，需要重新扫码登录。确定退出？',
      okText: '确定退出',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: async () => {
        await window.electronAPI.logout();
      },
    });
  }, [modal]);


  // 检查更新：结果交给全局监听处理（available/强制 → 弹窗），这里只处理"已是最新/失败"
  const handleCheckUpdate = useCallback(async () => {
    if (checkingUpdate) return;
    setCheckingUpdate(true);
    try {
      const r = await window.electronAPI.checkUpdate();
      if (r.phase === 'no-update') {
        message.success(`已是最新版本 v${r.currentVersion}`);
      } else if (r.phase === 'error') {
        message.error('检查更新失败，请稍后重试', 5);
      }
      // available / forceUpdate：MainView 的 onUpdateStatus 监听会自动弹窗
    } catch {
      message.error('检查更新失败，请稍后重试', 5);
    } finally {
      setCheckingUpdate(false);
    }
  }, [checkingUpdate]);

  // ============ 环境配置（开发者选项） ============
  // 与 Android TestPanelActivity 对齐
  const loadEnvConfig = useCallback(async () => {
    const config = await window.electronAPI.getEnvConfig();
    setEnvConfig(config);
    setBaseUrlChoice(matchEnvChoice(config.baseUrl, ENV_PROD.baseUrl, ENV_TEST.baseUrl));
    setWsUrlChoice(matchEnvChoice(config.wsUrl, ENV_PROD.wsUrl, ENV_TEST.wsUrl));
    setAppFeUrlChoice(matchEnvChoice(config.appFeUrl, ENV_PROD.appFeUrl, ENV_TEST.appFeUrl));
    if (matchEnvChoice(config.baseUrl, ENV_PROD.baseUrl, ENV_TEST.baseUrl) === 'custom') {
      setCustomBaseUrl(config.baseUrl);
    }
    if (matchEnvChoice(config.wsUrl, ENV_PROD.wsUrl, ENV_TEST.wsUrl) === 'custom') {
      setCustomWsUrl(config.wsUrl);
    }
    if (matchEnvChoice(config.appFeUrl, ENV_PROD.appFeUrl, ENV_TEST.appFeUrl) === 'custom') {
      setCustomAppFeUrl(config.appFeUrl);
    }
  }, []);

  const resolveEnvUrl = (choice: EnvChoice, prod: string, test: string, custom: string): string => {
    if (choice === 'prod') return prod;
    if (choice === 'test') return test;
    return custom.trim();
  };

  const handleSaveEnv = useCallback(async () => {
    const baseUrl = resolveEnvUrl(baseUrlChoice, ENV_PROD.baseUrl, ENV_TEST.baseUrl, customBaseUrl);
    const wsUrl = resolveEnvUrl(wsUrlChoice, ENV_PROD.wsUrl, ENV_TEST.wsUrl, customWsUrl);
    const appFeUrl = resolveEnvUrl(appFeUrlChoice, ENV_PROD.appFeUrl, ENV_TEST.appFeUrl, customAppFeUrl);

    // 校验自定义输入非空
    if (baseUrlChoice === 'custom' && !baseUrl) {
      message.error('自定义 baseUrl 不能为空', 5);
      return;
    }
    if (wsUrlChoice === 'custom' && !wsUrl) {
      message.error('自定义 wsUrl 不能为空', 5);
      return;
    }
    if (appFeUrlChoice === 'custom' && !appFeUrl) {
      message.error('自定义 appFeUrl 不能为空', 5);
      return;
    }

    const ok = await window.electronAPI.saveEnvConfig({ baseUrl, wsUrl, appFeUrl });
    if (ok) {
      message.success('配置已保存，正在重启...');
      // 断开 WS → 重连新地址 → 重新加载页面
      setTimeout(() => {
        window.electronAPI.restartApp();
      }, 500);
    } else {
      message.error('配置保存失败，请检查 URL 格式', 5);
    }
  }, [baseUrlChoice, wsUrlChoice, appFeUrlChoice, customBaseUrl, customWsUrl, customAppFeUrl]);

  const handleResetEnv = useCallback(async () => {
    modal.confirm({
      title: '重置环境配置',
      content: '将恢复为生产环境默认配置，需要重启应用。确定继续？',
      okText: '确定重置',
      cancelText: '取消',
      onOk: async () => {
        const ok = await window.electronAPI.resetEnvConfig();
        if (ok) {
          message.success('已重置为默认配置，正在重启...');
          setTimeout(() => {
            window.electronAPI.restartApp();
          }, 500);
        }
      },
    });
  }, [message, modal]);

  if (!prefs) return null;

  return (
    <div className="settings-page">
      <h2>设置</h2>

      {/* 设备和账号 */}
      <div className="settings-group">
        <div className="settings-group-title">设备和账号</div>
        <div className="settings-row">
          <div className="settings-label">UID</div>
          <div className="settings-value">
            <span>{loginInfo?.uid || '-'}</span>
            <button onClick={() => copyToClipboard(loginInfo?.uid || '')}>复制</button>
          </div>
        </div>
        <div className="settings-row">
          <div className="settings-label">SPT</div>
          <div className="settings-value">
            <span>{loginInfo?.spt || '-'}</span>
            <button onClick={() => copyToClipboard(loginInfo?.spt || '')}>复制</button>
          </div>
        </div>
        <div className="settings-row">
          <div className="settings-label">设备 ID</div>
          <div className="settings-value">
            <span>{loginInfo?.deviceUuid || '-'}</span>
            <button onClick={() => copyToClipboard(loginInfo?.deviceUuid || '')}>复制</button>
          </div>
        </div>
        <div className="settings-row">
          <div className="settings-label">退出登录</div>
          <div className="settings-value">
            <button className="primary" onClick={handleLogout}>
              退出登录
            </button>
            <span className="hint">退出后需重新扫码登录</span>
          </div>
        </div>
      </div>

      {/* 通知提醒 */}
      <div className="settings-group">
        <div className="settings-group-title">通知提醒</div>
        <div className="settings-row">
          <div className="settings-label">系统通知权限</div>
          <div className="settings-value">
            <div className="status-indicator">
              <span className={`dot ${notifPermission.granted ? 'green' : 'red'}`} />
              <span>{notifPermission.granted ? '已授权' : '未授权'}</span>
            </div>
            {notifPermission.guide === 'settings' && (
              <button onClick={() => window.electronAPI.openNotificationSettings()}>去开启</button>
            )}
            <button onClick={handleRecheckNotification}>
              重新检查
            </button>
            {notifPermission.canOpenSettings && (
              <button onClick={() => window.electronAPI.openNotificationSettings()}>
                去系统设置
              </button>
            )}
            {notifPermission.guide === 'manual' && (
              <span className="hint">
                请在系统的「通知」设置中允许 WxPusher 发送通知
              </span>
            )}
          </div>
        </div>
        <div className="settings-row">
          <div className="settings-label">推送检查</div>
          <div className="settings-value">
            <button onClick={handleRecheckPush} disabled={pushChecking}>
              {pushChecking ? '检查中...' : '重新检查'}
            </button>
          </div>
        </div>
        <div className="settings-row">
          <div className="settings-label">通知行为</div>
          <div className="settings-value">
            <Radio.Group
              value={prefs.notificationMode || 'normal'}
              onChange={(e) => {
                updatePref('notificationMode', e.target.value);
                window.electronAPI.setNotificationMode(e.target.value);
              }}
            >
              <Radio value="normal">正常通知</Radio>
              <Radio value="silent">静音通知</Radio>
              <Radio value="quiet">不通知提醒</Radio>
            </Radio.Group>
            {notifPermission.canOpenSettings && (
              <button onClick={() => window.electronAPI.openNotificationSettings()}>
                去系统设置
              </button>
            )}
          </div>
        </div>
      </div>

      {/* 桌面专属 */}
      <div className="settings-group">
        <div className="settings-group-title">桌面专属</div>
        <div className="settings-row">
          <div className="settings-label">开机自启</div>
          <div className="settings-value">
            <Switch
              checked={autoLaunch}
              onChange={(checked) => {
                setAutoLaunch(checked);
                window.electronAPI.setAutoLaunch(checked);
              }}
            />
            <span className="hint">强烈建议您打开，避免遗漏消息</span>
          </div>
        </div>
        <div className="settings-row">
          <div className="settings-label">启动后显示窗口</div>
          <div className="settings-value">
            <Switch
              checked={prefs.launchShowMainWindow}
              onChange={(checked) => updatePref('launchShowMainWindow', checked)}
            />
          </div>
        </div>
        <div className="settings-row">
          <div className="settings-label">数据目录</div>
          <div className="settings-value">
            <span className="monospace">{dataPath}</span>
            <button onClick={() => window.electronAPI.showInFolder(dataPath)}>
              <FolderOpen size={12} />
              在文件管理器中打开
            </button>
          </div>
        </div>
      </div>

      {/* 通用 */}
      <div className="settings-group">
        <div className="settings-group-title">通用</div>
        <div className="settings-row">
          <div className="settings-label">反馈建议</div>
          <div className="settings-value">
            <button
              onClick={() =>
                window.electronAPI.openExternal('https://wj.qq.com/s2/22198188/cc95/')
              }
            >
              <ExternalLink size={12} />
              提交反馈
            </button>
          </div>
        </div>
        <div className="settings-row">
          <div className="settings-label">用户协议</div>
          <div className="settings-value">
            <button
              onClick={() =>
                window.electronAPI.openExternal(
                  'https://wxpusher.zjiecode.com/admin/agreement/index-argeement.html'
                )
              }
            >
              查看
            </button>
          </div>
        </div>
        <div className="settings-row">
          <div className="settings-label">版本</div>
          <div className="settings-value">
            <span>WxPusher Desktop For {platform} v{appVersion || '—'}</span>
            <button onClick={handleCheckUpdate} disabled={checkingUpdate}>
              {checkingUpdate ? '检查中…' : '检查更新'}
            </button>
          </div>
        </div>
      </div>

      {/* ============ 开发者选项：环境配置 ============ */}
      {/* 与 Android TestPanelActivity 对齐，仅 dev 模式可见 */}
      {isDev && envConfig && (
        <div className="settings-group env-config-group">
          <div className="settings-group-title">开发者选项 · 环境配置</div>

          {/* baseUrl */}
          <div className="settings-row env-row">
            <div className="settings-label">API 地址</div>
            <div className="settings-value">
              <Radio.Group
                value={baseUrlChoice}
                onChange={(e) => setBaseUrlChoice(e.target.value)}
              >
                <Radio value="prod">生产 {ENV_PROD.baseUrl}</Radio>
                <Radio value="test">测试 {ENV_TEST.baseUrl}</Radio>
                <Radio value="custom">自定义</Radio>
              </Radio.Group>
              {baseUrlChoice === 'custom' && (
                <Input
                  className="env-custom-input"
                  placeholder="https://your-api-host.com"
                  value={customBaseUrl}
                  onChange={(e) => setCustomBaseUrl(e.target.value)}
                />
              )}
            </div>
          </div>

          {/* wsUrl */}
          <div className="settings-row env-row">
            <div className="settings-label">WS 地址</div>
            <div className="settings-value">
              <Radio.Group
                value={wsUrlChoice}
                onChange={(e) => setWsUrlChoice(e.target.value)}
              >
                <Radio value="prod">生产 {ENV_PROD.wsUrl}</Radio>
                <Radio value="test">测试 {ENV_TEST.wsUrl}</Radio>
                <Radio value="custom">自定义</Radio>
              </Radio.Group>
              {wsUrlChoice === 'custom' && (
                <Input
                  className="env-custom-input"
                  placeholder="wss://your-ws-host.com"
                  value={customWsUrl}
                  onChange={(e) => setCustomWsUrl(e.target.value)}
                />
              )}
            </div>
          </div>

          {/* appFeUrl */}
          <div className="settings-row env-row">
            <div className="settings-label">前端地址</div>
            <div className="settings-value">
              <Radio.Group
                value={appFeUrlChoice}
                onChange={(e) => setAppFeUrlChoice(e.target.value)}
              >
                <Radio value="prod">生产 {ENV_PROD.appFeUrl}</Radio>
                <Radio value="test">测试 {ENV_TEST.appFeUrl}</Radio>
                <Radio value="custom">自定义</Radio>
              </Radio.Group>
              {appFeUrlChoice === 'custom' && (
                <Input
                  className="env-custom-input"
                  placeholder="https://your-fe-host.com"
                  value={customAppFeUrl}
                  onChange={(e) => setCustomAppFeUrl(e.target.value)}
                />
              )}
            </div>
          </div>

          {/* 操作按钮 */}
          <div className="settings-row">
            <div className="settings-label">操作</div>
            <div className="settings-value env-actions">
              <button className="primary" onClick={handleSaveEnv}>
                保存并重启
              </button>
              <button onClick={handleResetEnv}>
                恢复默认
              </button>
              <span className="hint">修改后需重启应用生效</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
