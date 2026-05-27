import { useEffect, useState } from 'react';

interface WindowControlsProps {
  platform: string;
}

type WindowControlsApi = typeof window.electronAPI & {
  isMaximized: () => Promise<boolean>;
  onMaximizedChange: (callback: (maximized: boolean) => void) => (() => void) | undefined;
};

export default function WindowControls({ platform }: WindowControlsProps) {
  const useCustomControls = platform === 'win32' || platform === 'linux';
  const [maximized, setMaximized] = useState(false);
  const electronAPI = window.electronAPI as WindowControlsApi;

  useEffect(() => {
    if (!useCustomControls) return;

    let disposed = false;
    electronAPI
      .isMaximized()
      .then((value: boolean) => {
        if (!disposed) setMaximized(Boolean(value));
      })
      .catch(() => {});

    let offMaximizedChange: (() => void) | undefined;
    try {
      offMaximizedChange = electronAPI.onMaximizedChange((value: boolean) => {
        setMaximized(Boolean(value));
      });
    } catch {}

    return () => {
      disposed = true;
      offMaximizedChange?.();
    };
  }, [useCustomControls]);

  if (!useCustomControls) return null;

  return (
    <div className="window-controls" aria-label="窗口控制按钮">
      <button
        type="button"
        className="window-control-btn"
        title="最小化"
        aria-label="最小化"
        onClick={() => electronAPI.minimizeWindow()}
      >
        <svg className="window-control-icon" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M1.5 5h7" />
        </svg>
      </button>
      <button
        type="button"
        className="window-control-btn"
        title={maximized ? '还原' : '最大化'}
        aria-label={maximized ? '还原' : '最大化'}
        onClick={async () => {
          try {
            await electronAPI.maximizeWindow();
          } catch {}
        }}
      >
        {maximized ? (
          <svg className="window-control-icon" viewBox="0 0 10 10" aria-hidden="true">
            <path d="M2 3h5v5H2z" />
            <path d="M3 2h5v5" />
          </svg>
        ) : (
          <svg className="window-control-icon" viewBox="0 0 10 10" aria-hidden="true">
            <path d="M2 2h6v6H2z" />
          </svg>
        )}
      </button>
      <button
        type="button"
        className="window-control-btn close"
        title="关闭"
        aria-label="关闭"
        onClick={() => electronAPI.closeWindow()}
      >
        <svg className="window-control-icon" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M2 2l6 6" />
          <path d="M8 2l-6 6" />
        </svg>
      </button>
    </div>
  );
}
