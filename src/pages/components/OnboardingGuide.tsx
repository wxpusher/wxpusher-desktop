import { useState, useEffect, useCallback } from 'react';
import { Modal, Switch } from 'antd';
import { CheckCircle } from 'lucide-react';
import type { NotifyPermissionState } from '../../types';
import { LINUX_NOTIFY_HINT } from '../../utils/notify';

export default function OnboardingGuide() {
  const [show, setShow] = useState(false);
  const [autoLaunch, setAutoLaunch] = useState(true);
  const [notify, setNotify] = useState<NotifyPermissionState | null>(null);
  const [platform, setPlatform] = useState('');

  useEffect(() => {
    // 仅在首次登录后引导：直接读取持久化偏好后再决定是否展示，
    // 避免用初始默认值抢先弹窗，导致老用户每次打开都重复看到。
    let active = true;
    window.electronAPI.getPref('onboardingCompleted').then((v) => {
      if (active && !v) setShow(true);
    });
    return () => {
      active = false;
    };
  }, []);

  // 通知权限状态：跨平台差异已由主进程归一到 NotifyPermissionState。
  // 复用 NotificationBanner 的 focus 复检：用户去系统设置授权后切回窗口时自动刷新。
  const checkNotify = useCallback(async () => {
    const result = await window.electronAPI.checkNotificationPermission();
    setNotify(result);
  }, []);

  useEffect(() => {
    if (!show) return;
    checkNotify();
    window.electronAPI.getPlatform().then(setPlatform);
    window.addEventListener('focus', checkNotify);
    return () => window.removeEventListener('focus', checkNotify);
  }, [show, checkNotify]);

  if (!show) return null;

  // macOS 的通知授权态不可靠：未签名 / 首次未调用 requestAuthorization 时，
  // getAuthStatus 常停留在 'not determined'，断言「已开启 / 未开启」都会误导。
  // 因此 macOS 一律展示中性引导 + 「去开启」按钮，不显示开启状态。
  const isMac = platform === 'darwin';

  return (
    <Modal
      open={show}
      title="欢迎使用 WxPusher Desktop"
      footer={null}
      closable={false}
      centered
      width={400}
    >
      <div className="onboarding-content">
        <div className="onboarding-row">
          <div>
            <div className="onboarding-label">开机自启</div>
            <div className="onboarding-desc">推荐开启，确保不错过重要消息</div>
          </div>
          <Switch
            checked={autoLaunch}
            onChange={(checked) => {
              setAutoLaunch(checked);
            }}
          />
        </div>

        <div className="onboarding-row">
          <div>
            <div className="onboarding-label">通知权限</div>
            <div className="onboarding-desc">
              {isMac
                ? '请在「系统设置」中开启通知，确保桌面提醒可正常弹出'
                : notify?.granted
                  ? '已开启，可正常接收桌面提醒'
                  : notify?.guide === 'manual'
                    ? LINUX_NOTIFY_HINT
                    : '未开启，桌面提醒将无法弹出'}
            </div>
          </div>
          {!isMac && notify?.granted ? (
            <span className="onboarding-status-ok">
              <CheckCircle size={16} />
              已开启
            </span>
          ) : isMac || notify?.guide === 'settings' ? (
            <button
              className="btn-secondary"
              onClick={() => window.electronAPI.openNotificationSettings()}
            >
              去开启
            </button>
          ) : null}
        </div>
      </div>
      <div style={{ textAlign: 'right', marginTop: 24 }}>
        <button
          className="btn-primary"
          onClick={() => {
            setShow(false);
            window.electronAPI.setPref('onboardingCompleted', true);
            if (autoLaunch) {
              window.electronAPI.setAutoLaunch(true);
            }
          }}
        >
          开始使用
        </button>
      </div>
    </Modal>
  );
}
