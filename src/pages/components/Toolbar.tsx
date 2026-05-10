import { useState, useEffect } from 'react';
import { useAppStore } from '../../stores/appStore';

export default function Toolbar() {
  const wsStatus = useAppStore((s) => s.wsStatus);
  const [platform, setPlatform] = useState('');

  useEffect(() => {
    window.electronAPI.getPlatform().then(setPlatform);
  }, []);

  const statusText =
    wsStatus === 'Connected'
      ? 'WS 已连接'
      : wsStatus === 'Connecting'
        ? '连接中...'
        : 'WS 已断开';

  const statusClass =
    wsStatus === 'Connected'
      ? 'online'
      : wsStatus === 'Connecting'
        ? 'connecting'
        : 'offline';

  return (
    <div className="toolbar">
      <div className="toolbar-left">
        {platform === 'darwin' && <div className="traffic-lights-spacer" />}
      </div>
      <div className="toolbar-right">
        <div className={`ws-status ${statusClass}`} title="连接状态">
          <span className={`dot ${statusClass}`} />
          <span>{statusText}</span>
        </div>
      </div>
    </div>
  );
}
