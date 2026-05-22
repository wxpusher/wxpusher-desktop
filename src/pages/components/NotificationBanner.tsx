import { useState, useEffect, useCallback } from 'react';
import { XCircle } from 'lucide-react';
import { useAppStore } from '../../stores/appStore';
import type { NotifyPermissionState } from '../../types';

// Linux 无统一的系统通知设置入口,只能文案引导
const LINUX_HINT =
  '请在系统的「通知」设置中允许 WxPusher 发送通知（GNOME：设置 → 通知；KDE：系统设置 → 通知）。';

export default function NotificationBanner() {
  const [state, setState] = useState<NotifyPermissionState>({
    supported: true,
    granted: true,
    guide: 'none',
    canOpenSettings: false,
  });
  const notifyPermissionDismissedAt = useAppStore((s) => s.notifyPermissionDismissedAt);

  const check = useCallback(async () => {
    const result = await window.electronAPI.checkNotificationPermission();
    setState(result);
  }, []);

  useEffect(() => {
    check();
    window.addEventListener('focus', check);
    return () => window.removeEventListener('focus', check);
  }, [check]);

  // 用户点过"忽略"后本次启动内不再展示(不持久化,下次启动若仍无权限会再次出现)
  if (state.granted || notifyPermissionDismissedAt != null) {
    return null;
  }

  return (
    <div className="notification-banner">
      <XCircle size={16} />
      <span>
        {state.guide === 'manual'
          ? `通知权限未开启，桌面提醒将无法弹出。${LINUX_HINT}`
          : '通知权限未开启，桌面提醒将无法弹出'}
      </span>
      {state.guide === 'settings' && (
        <button onClick={() => window.electronAPI.openNotificationSettings()}>去开启</button>
      )}
      <button
        className="ignore"
        onClick={() => useAppStore.getState().setNotifyPermissionDismissedAt(Date.now())}
      >
        忽略
      </button>
    </div>
  );
}
