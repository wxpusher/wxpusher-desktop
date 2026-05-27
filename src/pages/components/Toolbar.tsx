import { useState, useEffect, type MouseEvent } from 'react';
import { useAppStore } from '../../stores/appStore';
import { WS_STATUS } from '../../../electron/ipc/wsStatus';
import { WS_STATUS_DISPLAY } from '../../utils/wsStatusDisplay';
import WindowControls from './WindowControls';

export default function Toolbar() {
  const wsStatus = useAppStore((s) => s.wsStatus);
  const updateStatus = useAppStore((s) => s.updateStatus);
  const dismissedVersion = useAppStore((s) => s.updateDismissedVersion);
  const setUpdateModalOpen = useAppStore((s) => s.setUpdateModalOpen);
  const [platform, setPlatform] = useState('');
  const [appVersion, setAppVersion] = useState('');

  useEffect(() => {
    window.electronAPI.getPlatform().then(setPlatform);
    window.electronAPI.getAppVersion().then(setAppVersion);
  }, []);

  const d = WS_STATUS_DISPLAY[wsStatus] ?? WS_STATUS_DISPLAY[WS_STATUS.Connecting];

  // 有更新且未被忽略（或强制）→ 显示气泡；否则显示纯文本版本号
  const phase = updateStatus?.phase;
  const forced = !!updateStatus?.forceUpdate;
  const dismissed =
    !forced &&
    updateStatus?.latestVersion != null &&
    dismissedVersion === updateStatus.latestVersion;
  const hasUpdate =
    !!updateStatus &&
    !dismissed &&
    (phase === 'available' || phase === 'downloading' || phase === 'downloaded');

  let pillText = '';
  if (hasUpdate) {
    if (phase === 'downloading') pillText = `下载中 ${updateStatus?.percent ?? 0}%`;
    else if (phase === 'downloaded') pillText = '新版本已就绪';
    else
      pillText = updateStatus?.latestVersion
        ? `新版本 v${updateStatus.latestVersion}`
        : '发现新版本';
  }

  const version = updateStatus?.currentVersion || appVersion;
  const handleToolbarDoubleClick = (event: MouseEvent<HTMLDivElement>) => {
    if (platform === 'darwin') return;
    const target = event.target as HTMLElement | null;
    if (target?.closest('.toolbar-right')) return;
    window.electronAPI.maximizeWindow();
  };

  return (
    <div className="toolbar" onDoubleClick={handleToolbarDoubleClick}>
      <div className="toolbar-left">
        {platform === 'darwin' && <div className="traffic-lights-spacer" />}
      </div>
      <div className="toolbar-right">
        {hasUpdate ? (
          <button
            type="button"
            className="update-pill"
            data-tip="点击查看新版本"
            onClick={() => setUpdateModalOpen(true)}
          >
            <span className="dot" />
            <span>{pillText}</span>
          </button>
        ) : (
          version && <span className="app-version">v{version}</span>
        )}
        <div className={`ws-status ${d.tone}`} data-tip={d.tip}>
          <span className={`dot ${d.tone}`} />
          <span>{d.text}</span>
        </div>
        <WindowControls platform={platform} />
      </div>
    </div>
  );
}
