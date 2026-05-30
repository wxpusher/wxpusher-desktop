import { useState, useEffect } from 'react';
import { Modal, Switch } from 'antd';

export default function OnboardingGuide() {
  const [show, setShow] = useState(false);
  const [autoLaunch, setAutoLaunch] = useState(true);

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

  if (!show) return null;

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
