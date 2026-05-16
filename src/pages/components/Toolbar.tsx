import { useState, useEffect } from 'react';
import { useAppStore } from '../../stores/appStore';
import { WS_STATUS } from '../../../electron/ipc/wsStatus';
import { WS_STATUS_DISPLAY } from '../../utils/wsStatusDisplay';

export default function Toolbar() {
  const wsStatus = useAppStore((s) => s.wsStatus);
  const [platform, setPlatform] = useState('');

  useEffect(() => {
    window.electronAPI.getPlatform().then(setPlatform);
  }, []);

  const d = WS_STATUS_DISPLAY[wsStatus] ?? WS_STATUS_DISPLAY[WS_STATUS.Connecting];

  return (
    <div className="toolbar">
      <div className="toolbar-left">
        {platform === 'darwin' && <div className="traffic-lights-spacer" />}
      </div>
      <div className="toolbar-right">
        <div className={`ws-status ${d.tone}`} data-tip={d.tip}>
          <span className={`dot ${d.tone}`} />
          <span>{d.text}</span>
        </div>
      </div>
    </div>
  );
}
