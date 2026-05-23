import { useState, useEffect } from 'react';
import { XCircle } from 'lucide-react';
import { useAppStore } from '../../stores/appStore';
import type { CheckAppMsgReason } from '../../types';

// 推送检查 banner：主进程 PushCheckManager 每小时（或设置页主动触发）跑一次推送链路探测，
// 服务端返回 code !== 0 时展示 reason；样式复用 .notification-banner，紧贴权限横条下方。
export default function PushCheckBanner() {
  const isLogged = useAppStore((s) => s.isLogged);
  const [result, setResult] = useState<CheckAppMsgReason | null>(null);

  useEffect(() => {
    // 冷启动先用持久化的上次结果即时渲染，避免等待新一次检查完成
    window.electronAPI.getLastPushCheck().then((r) => setResult(r.lastResult));
    const off = window.electronAPI.onPushCheckResult((r) => setResult(r));
    return () => {
      off?.();
    };
  }, []);

  if (!isLogged) return null;
  if (!result || result.code === 0) return null;

  return (
    <div className="notification-banner">
      <XCircle size={16} />
      <span>{result.reason || '推送状态异常'}</span>
    </div>
  );
}
