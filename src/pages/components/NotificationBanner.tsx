import { useState, useEffect } from 'react';
import { XCircle } from 'lucide-react';
import { useAppStore } from '../../stores/appStore';

export default function NotificationBanner() {
  const [granted, setGranted] = useState(true);
  const notifyPermissionDismissedAt = useAppStore((s) => s.notifyPermissionDismissedAt);

  useEffect(() => {
    const check = async () => {
      const result = await window.electronAPI.checkNotificationPermission();
      setGranted(result.granted);
    };
    check();
    window.addEventListener('focus', check);
    return () => window.removeEventListener('focus', check);
  }, []);

  // 用户点过"忽略"后 24 小时内不再展示
  if (
    granted ||
    (notifyPermissionDismissedAt &&
      Date.now() - notifyPermissionDismissedAt < 24 * 60 * 60 * 1000)
  ) {
    return null;
  }

  return (
    <div className="notification-banner">
      <XCircle size={16} />
      <span>通知权限未开启，桌面提醒将无法弹出</span>
      <button onClick={() => window.electronAPI.openNotificationSettings()}>去开启</button>
      <button
        className="ignore"
        onClick={() => {
          const now = Date.now();
          useAppStore.getState().setNotifyPermissionDismissedAt(now);
          window.electronAPI.setPref('notifyPermissionDismissedAt', now);
        }}
      >
        忽略
      </button>
    </div>
  );
}
