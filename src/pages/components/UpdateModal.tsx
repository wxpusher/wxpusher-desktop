import type { ReactNode } from 'react';
import { Modal, Progress, Spin } from 'antd';
import { useAppStore } from '../../stores/appStore';

/**
 * 更新弹窗：普通更新可关闭；forceUpdate=true 时为阻塞弹窗
 * （不可关闭 / 无遮罩关闭 / 无 ESC / 仅"更新并重启"），用户必须更新后才能继续使用。
 * 文案（标题/正文/版本号）全部来自后端 /api/device/version-update 接口。
 */
export default function UpdateModal() {
  const status = useAppStore((s) => s.updateStatus);
  const open = useAppStore((s) => s.updateModalOpen);
  const setOpen = useAppStore((s) => s.setUpdateModalOpen);
  const setDismissed = useAppStore((s) => s.setUpdateDismissed);

  if (!status) return null;

  const forced = !!status.forceUpdate;
  const { phase, dev } = status;
  const version = status.latestVersion;

  const close = () => setOpen(false);
  // "稍后"只关弹窗：后台继续下载、退出/重启时自动安装；同一版本"当天"不再自动弹窗打扰，
  // 但工具栏气泡入口始终保留，点它可随时再次打开弹窗。
  const later = () => {
    if (version) {
      const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
      setDismissed(version, today);
      window.electronAPI.setPref('updateDismissedVersion', version);
      window.electronAPI.setPref('updateDismissedDate', today);
    }
    close();
  };
  const doDownload = () => window.electronAPI.downloadUpdate();
  const doInstall = () => window.electronAPI.installUpdate();

  const footer: ReactNode[] = [];
  if (dev) {
    footer.push(
      <button key="ok" className="upd-btn primary" onClick={close}>
        我知道了
      </button>
    );
  } else if (phase === 'checking') {
    footer.push(
      <button key="checking" className="upd-btn primary" disabled>
        正在检查更新…
      </button>
    );
  } else if (phase === 'downloaded') {
    if (!forced)
      footer.push(
        <button key="later" className="upd-btn ghost" onClick={later}>
          稍后
        </button>
      );
    footer.push(
      <button key="install" className="upd-btn primary" onClick={doInstall}>
        更新并重启
      </button>
    );
  } else if (phase === 'downloading') {
    footer.push(
      <button key="dl" className="upd-btn primary" disabled>
        下载中 {status.percent ?? 0}%
      </button>
    );
  } else {
    if (!forced)
      footer.push(
        <button key="later" className="upd-btn ghost" onClick={later}>
          稍后
        </button>
      );
    footer.push(
      <button key="dl" className="upd-btn primary" onClick={doDownload}>
        立即更新
      </button>
    );
  }

  return (
    <Modal
      open={open}
      title={phase === 'checking' ? '检查更新' : status.title || '发现新版本'}
      closable={!forced}
      maskClosable={!forced}
      keyboard={!forced}
      onCancel={forced ? undefined : close}
      footer={<div className="upd-footer">{footer}</div>}
      width={420}
      centered
    >
      <div className="upd-body">
        {phase === 'checking' && (
          <div className="upd-checking">
            <Spin size="small" /> <span>正在检查更新，请稍候…</span>
          </div>
        )}
        {version && <div className="upd-version">新版本 v{version}</div>}
        {status.content && <div className="upd-content">{status.content}</div>}
        {phase === 'downloading' && (
          <Progress percent={status.percent ?? 0} size="small" status="active" />
        )}
        {forced && (
          <div className="upd-forced-tip">当前版本已不再支持，需更新后才能继续使用。</div>
        )}
        {dev && (
          <div className="upd-forced-tip">开发环境：自动更新不可用，仅展示更新信息。</div>
        )}
      </div>
    </Modal>
  );
}
