import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Checkbox, Spin, Modal, Radio, Input, message } from 'antd';
import { ExternalLink, RefreshCw, Settings } from 'lucide-react';
import { useAppStore } from '../../stores/appStore';
import type { LoginInfo } from '../../types';
import appIcon from '../../assets/icon.png';
import './styles.scss';

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

export default function LoginView() {
  const navigate = useNavigate();
  const wsStatus = useAppStore((s) => s.wsStatus);
  const [agreed, setAgreed] = useState(false);
  const [qrcodeUrl, setQrcodeUrl] = useState<string | null>(null);
  const [qrcodeCode, setQrcodeCode] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(300);
  const [pushTokenReady, setPushTokenReady] = useState(false);
  const [polling, setPolling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wsConnecting, setWsConnecting] = useState(true); // 默认 true：页面加载即开始连接 WS
  const [rebuildCount, setRebuildCount] = useState(0);
  const countdownRef = useRef<NodeJS.Timeout>();
  const pollingRef = useRef<NodeJS.Timeout>();
  const baseUrlRef = useRef('https://wxpusher.zjiecode.com');

  // 环境配置状态
  const [isDev, setIsDev] = useState(false);
  const [showEnvModal, setShowEnvModal] = useState(false);
  const [baseUrlChoice, setBaseUrlChoice] = useState<EnvChoice>('prod');
  const [wsUrlChoice, setWsUrlChoice] = useState<EnvChoice>('prod');
  const [appFeUrlChoice, setAppFeUrlChoice] = useState<EnvChoice>('prod');
  const [customBaseUrl, setCustomBaseUrl] = useState('');
  const [customWsUrl, setCustomWsUrl] = useState('');
  const [customAppFeUrl, setCustomAppFeUrl] = useState('');
  const rebuildCountRef = useRef(0);

  // expires 是过期时间戳（毫秒），需要计算剩余秒数
  const startCountdown = (expiresTimestamp: number) => {
    if (countdownRef.current) clearInterval(countdownRef.current);
    const calcRemaining = () => Math.max(0, Math.floor((expiresTimestamp - Date.now()) / 1000));
    setCountdown(calcRemaining());
    countdownRef.current = setInterval(() => {
      const remaining = calcRemaining();
      setCountdown(remaining);
      if (remaining <= 0) {
        clearInterval(countdownRef.current!);
      }
    }, 1000);
  };

  const startPolling = useCallback((code: string) => {
    if (pollingRef.current) return;
    setPolling(true);
    pollingRef.current = setInterval(async () => {
      try {
        const result = await window.electronAPI.login(code);
        if (result?.deviceToken) {
          clearInterval(pollingRef.current!);
          pollingRef.current = undefined;
          // 先用基础凭证信息设置登录状态，跳转主页
          useAppStore.getState().setLogged(result as LoginInfo);
          message.success('登录成功');
          navigate('/', { replace: true });
          // 后台获取完整用户信息并更新
          window.electronAPI.getUserDeviceInfo().then((info) => {
            if (info) {
              useAppStore.getState().updateLoginInfo(info);
            }
          }).catch(() => {});
        }
      } catch (e: any) {
        if (e?.code === 10000) {
          // BIZ_WAIT_SCAN_LOGIN，继续轮询
        } else if (e?.message?.includes('expired') || e?.code === 'QR_EXPIRED') {
          clearInterval(pollingRef.current!);
          pollingRef.current = undefined;
          if (rebuildCountRef.current < 1) {
            rebuildCountRef.current++;
            setRebuildCount(rebuildCountRef.current);
            try {
              setError(null);
              setQrcodeUrl(null);
              const { code: newCode, expires } = await window.electronAPI.createLoginQrcode();
              setQrcodeCode(newCode);
              setQrcodeUrl(`${baseUrlRef.current}/api/qrcode/${newCode}.jpg`);
              setCountdown(expires);
              startCountdown(expires);
              startPolling(newCode);
            } catch {
              setError('二维码加载失败，请重试');
            }
          } else {
            setError('二维码已过期，请刷新');
          }
        }
      }
    }, 3000);
  }, []);

  const handleRefreshQrcode = useCallback(async () => {
    try {
      setError(null);
      setQrcodeUrl(null);
      const { code, expires } = await window.electronAPI.createLoginQrcode();
      setQrcodeCode(code);
      setQrcodeUrl(`${baseUrlRef.current}/api/qrcode/${code}.jpg`);
      setCountdown(expires);
      startCountdown(expires);
      if (pushTokenReady) {
        startPolling(code);
      }
    } catch {
      setError('二维码加载失败，请重试');
    }
  }, [pushTokenReady, startPolling]);

  const handleAgree = async () => {
    setAgreed(true);
    // 请求通知权限
    window.electronAPI.checkNotificationPermission();
    // 加载二维码
    try {
      const { code, expires } = await window.electronAPI.createLoginQrcode();
      setQrcodeCode(code);
      setQrcodeUrl(`${baseUrlRef.current}/api/qrcode/${code}.jpg`);
      setCountdown(expires);
      startCountdown(expires);
      // 如果 pushToken 已就绪，立即开始轮询
      if (pushTokenReady) {
        startPolling(code);
      }
    } catch {
      setError('二维码加载失败，请重试');
    }
  };

  // 页面挂载时：注册 pushToken 监听、检查 pushToken、加载环境配置
  useEffect(() => {
    console.log('[LoginView] mount: 注册 onPushToken 监听');
    // 监听 WS 下发的 pushToken（后续推送）
    const cleanup = window.electronAPI.onPushToken((token) => {
      console.log('[LoginView] 收到 pushToken:', token);
      setPushTokenReady(true);
      setWsConnecting(false);
    });

    // 检查 pushToken 是否已就绪（WS 可能在页面挂载前就已收到 DEVICE_INIT）
    window.electronAPI.hasPushToken().then((has) => {
      if (has) {
        console.log('[LoginView] pushToken 已就绪（WS 先于页面挂载）');
        setPushTokenReady(true);
        setWsConnecting(false);
      }
    });

    // 立即建立 WS 连接（不等用户同意协议）
    window.electronAPI.wsConnect();

    // 加载环境配置
    window.electronAPI.getEnvConfig().then((config) => {
      baseUrlRef.current = config.baseUrl;
    });
    window.electronAPI.isPackaged().then((packaged) => {
      const devMode = !packaged;
      setIsDev(devMode);
      if (devMode) {
        loadEnvConfig();
      }
    });

    return () => {
      cleanup?.();
    };
  }, []);

  // 加载环境配置
  const loadEnvConfig = useCallback(async () => {
    const config = await window.electronAPI.getEnvConfig();
    baseUrlRef.current = config.baseUrl;
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

    if (baseUrlChoice === 'custom' && !baseUrl) {
      message.error('自定义 baseUrl 不能为空');
      return;
    }
    if (wsUrlChoice === 'custom' && !wsUrl) {
      message.error('自定义 wsUrl 不能为空');
      return;
    }
    if (appFeUrlChoice === 'custom' && !appFeUrl) {
      message.error('自定义 appFeUrl 不能为空');
      return;
    }

    const ok = await window.electronAPI.saveEnvConfig({ baseUrl, wsUrl, appFeUrl });
    if (ok) {
      message.success('配置已保存，正在重启...');
      setShowEnvModal(false);
      setTimeout(() => {
        window.electronAPI.restartApp();
      }, 500);
    } else {
      message.error('配置保存失败，请检查 URL 格式');
    }
  }, [baseUrlChoice, wsUrlChoice, appFeUrlChoice, customBaseUrl, customWsUrl, customAppFeUrl]);

  const handleResetEnv = useCallback(async () => {
    const ok = await window.electronAPI.resetEnvConfig();
    if (ok) {
      message.success('已重置为默认配置，正在重启...');
      setShowEnvModal(false);
      setTimeout(() => {
        window.electronAPI.restartApp();
      }, 500);
    }
  }, []);

  // pushToken 就绪后，如果已有二维码则启动轮询
  useEffect(() => {
    console.log('[LoginView] polling check: pushTokenReady=', pushTokenReady, 'qrcodeCode=', qrcodeCode);
    if (pushTokenReady && qrcodeCode && !pollingRef.current) {
      console.log('[LoginView] 条件满足，启动轮询');
      startPolling(qrcodeCode);
    }
  }, [pushTokenReady, qrcodeCode, startPolling]);

  // 清理
  useEffect(() => {
    return () => {
      if (countdownRef.current) clearInterval(countdownRef.current);
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, []);

  return (
    <div className="login-page">
      <div className="login-card">
        <img className="login-logo-img" src={appIcon} alt="WxPusher" width={64} height={64} />
        <div className="login-title">WxPusher</div>

        {!agreed ? (
          <>
            <div className="login-qr-area">
              <div className="login-qr-placeholder">
                <span>请先同意用户协议</span>
              </div>
            </div>
            <div className="login-agreement">
              <Checkbox checked={agreed} onChange={(e) => e.target.checked && handleAgree()}>
                <span>
                  我已阅读并同意{' '}
                  <a
                    href="#"
                    onClick={(e) => {
                      e.preventDefault();
                      window.electronAPI.openExternal(
                        'https://wxpusher.zjiecode.com/docs/agreement.html'
                      );
                    }}
                  >
                    《用户协议》
                  </a>{' '}
                  和{' '}
                  <a
                    href="#"
                    onClick={(e) => {
                      e.preventDefault();
                      window.electronAPI.openExternal(
                        'https://wxpusher.zjiecode.com/docs/privacy.html'
                      );
                    }}
                  >
                    《隐私政策》
                  </a>
                </span>
              </Checkbox>
            </div>
          </>
        ) : (
          <>
            <div className="login-qr-area">
              {qrcodeUrl ? (
                <>
                  <img
                    className={`login-qr-img ${countdown <= 0 ? 'expired' : ''}`}
                    src={qrcodeUrl}
                    alt="登录二维码"
                    width={200}
                    height={200}
                  />
                  <div className="login-qr-tip">
                    请使用 WxPusher App 或微信扫码登录
                  </div>
                  <div className="login-countdown">
                    {countdown > 30 ? (
                      <span>剩余 {Math.floor(countdown / 60)}:{String(countdown % 60).padStart(2, '0')}</span>
                    ) : countdown > 0 ? (
                      <span className="expiring">即将过期 ({countdown}s)</span>
                    ) : (
                      <span className="expired">已过期</span>
                    )}
                    <span>·</span>
                    <a onClick={handleRefreshQrcode}>
                      <RefreshCw size={12} />
                      刷新二维码
                    </a>
                  </div>
                  {wsConnecting && (
                    <div className="login-connecting">
                      <Spin size="small" />
                      <span>正在连接服务...</span>
                    </div>
                  )}
                </>
              ) : (
                <div className="login-loading">
                  <Spin tip="加载二维码中..." />
                </div>
              )}
              {error && <div className="login-error">{error}</div>}
            </div>
          </>
        )}

        <div className="login-footer">
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              window.electronAPI.openExternal(
                'https://wxpusher.zjiecode.com/docs/download.html'
              );
            }}
          >
            <ExternalLink size={14} />
            还没安装 WxPusher App？
          </a>
          {isDev && (
            <a
              href="#"
              className="env-config-link"
              onClick={(e) => {
                e.preventDefault();
                loadEnvConfig();
                setShowEnvModal(true);
              }}
            >
              <Settings size={14} />
              环境配置
            </a>
          )}
        </div>
      </div>

      {/* 连接状态 */}
      <div className="login-status">
        {wsStatus === 'Connected' ? (
          <>
            <span className="status-dot online" />
            <span>已连接</span>
          </>
        ) : wsStatus === 'Connecting' ? (
          <>
            <span className="status-dot connecting" />
            <span>连接中...</span>
          </>
        ) : (
          <>
            <span className="status-dot offline" />
            <span>未连接</span>
          </>
        )}
      </div>

      {/* 环境配置弹窗（仅 dev 模式） */}
      <Modal
        title="开发者选项 · 环境配置"
        open={showEnvModal}
        onCancel={() => setShowEnvModal(false)}
        footer={null}
        width={520}
        centered
      >
        <div className="env-modal-content">
          {/* baseUrl */}
          <div className="env-group">
            <div className="env-group-label">API 地址</div>
            <Radio.Group
              value={baseUrlChoice}
              onChange={(e) => setBaseUrlChoice(e.target.value)}
              className="env-radio-group"
            >
              <Radio value="prod">生产</Radio>
              <Radio value="test">测试</Radio>
              <Radio value="custom">自定义</Radio>
            </Radio.Group>
            {baseUrlChoice === 'custom' ? (
              <Input
                className="env-custom-input"
                placeholder="https://your-api-host.com"
                value={customBaseUrl}
                onChange={(e) => setCustomBaseUrl(e.target.value)}
              />
            ) : (
              <div className="env-url-preview">{resolveEnvUrl(baseUrlChoice, ENV_PROD.baseUrl, ENV_TEST.baseUrl, '')}</div>
            )}
          </div>

          {/* wsUrl */}
          <div className="env-group">
            <div className="env-group-label">WS 地址</div>
            <Radio.Group
              value={wsUrlChoice}
              onChange={(e) => setWsUrlChoice(e.target.value)}
              className="env-radio-group"
            >
              <Radio value="prod">生产</Radio>
              <Radio value="test">测试</Radio>
              <Radio value="custom">自定义</Radio>
            </Radio.Group>
            {wsUrlChoice === 'custom' ? (
              <Input
                className="env-custom-input"
                placeholder="wss://your-ws-host.com"
                value={customWsUrl}
                onChange={(e) => setCustomWsUrl(e.target.value)}
              />
            ) : (
              <div className="env-url-preview">{resolveEnvUrl(wsUrlChoice, ENV_PROD.wsUrl, ENV_TEST.wsUrl, '')}</div>
            )}
          </div>

          {/* appFeUrl */}
          <div className="env-group">
            <div className="env-group-label">前端地址</div>
            <Radio.Group
              value={appFeUrlChoice}
              onChange={(e) => setAppFeUrlChoice(e.target.value)}
              className="env-radio-group"
            >
              <Radio value="prod">生产</Radio>
              <Radio value="test">测试</Radio>
              <Radio value="custom">自定义</Radio>
            </Radio.Group>
            {appFeUrlChoice === 'custom' ? (
              <Input
                className="env-custom-input"
                placeholder="https://your-fe-host.com"
                value={customAppFeUrl}
                onChange={(e) => setCustomAppFeUrl(e.target.value)}
              />
            ) : (
              <div className="env-url-preview">{resolveEnvUrl(appFeUrlChoice, ENV_PROD.appFeUrl, ENV_TEST.appFeUrl, '')}</div>
            )}
          </div>

          {/* 操作按钮 */}
          <div className="env-modal-footer">
            <button className="env-btn-reset" onClick={handleResetEnv}>
              恢复默认
            </button>
            <button className="env-btn-save" onClick={handleSaveEnv}>
              保存并重启
            </button>
          </div>
          <div className="env-modal-hint">修改后需重启应用生效</div>
        </div>
      </Modal>
    </div>
  );
}
