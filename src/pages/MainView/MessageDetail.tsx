import { useEffect, useMemo, useRef, useState } from 'react';
import { useAppStore } from '../../stores/appStore';
import type { MessageItem } from '../../types';

interface Props {
  message: MessageItem | null;
}

// 网络加载兜底超时（非 UX 阈值）：仅用于避免 iframe 既不触发 onLoad 也不触发 onError 时进度条永久转动
const LOAD_TIMEOUT_MS = 60000;
// 点列表加载时，超过这个时间还没加载完才显示进度条（2s 内加载完则完全不显示，防闪烁）
const REVEAL_DELAY_MS = 2000;
// 进度条一旦显示，至少停留这么久再隐藏，避免显示后立刻消失的闪烁
const MIN_VISIBLE_MS = 500;

type LoadStatus = 'loading' | 'loaded' | 'error';

export default function MessageDetail({ message }: Props) {
  const [status, setStatus] = useState<LoadStatus>('loading');
  const [showBar, setShowBar] = useState(false);
  const [retry, setRetry] = useState(0);
  // 本次加载是否由「重新加载」触发：是则进度条立即显示，否则延迟 2s
  const isRetryRef = useRef(false);
  const shownAtRef = useRef(0);
  const revealTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const settleTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const timeoutTimerRef = useRef<ReturnType<typeof setTimeout>>();
  // 每次加载自增，settle / 兜底回调据此忽略来自上一次加载的过期触发
  const loadGenRef = useRef(0);
  // did-fail-load 已判定失败的加载代次：此后该次加载的错误页 onLoad 不能再翻回成功
  const failedGenRef = useRef(-1);

  const iframeKey = useMemo(() => {
    if (!message) return 'empty';
    return `${message.messageId}:${message.url || ''}:${retry}`;
  }, [message, retry]);

  // 切换消息 / url / 重试时重置加载状态机与定时器
  useEffect(() => {
    if (!message || !message.url) {
      setStatus('loaded');
      setShowBar(false);
      return;
    }
    clearTimeout(revealTimerRef.current);
    clearTimeout(settleTimerRef.current);
    clearTimeout(timeoutTimerRef.current);
    shownAtRef.current = 0;
    const gen = ++loadGenRef.current;
    setStatus('loading');

    const isRetry = isRetryRef.current;
    isRetryRef.current = false;
    if (isRetry) {
      // 重试：立即显示进度条给出即时反馈
      setShowBar(true);
      shownAtRef.current = Date.now();
    } else {
      // 点列表：2s 内加载完不显示，超过 2s 才显示进度条
      setShowBar(false);
      revealTimerRef.current = setTimeout(() => {
        setShowBar(true);
        shownAtRef.current = Date.now();
      }, REVEAL_DELAY_MS);
    }

    // 兜底超时：到时仍在 loading 则判定失败
    timeoutTimerRef.current = setTimeout(() => {
      if (loadGenRef.current !== gen) return;
      setStatus((prev) => (prev === 'loading' ? 'error' : prev));
    }, LOAD_TIMEOUT_MS);

    return () => {
      clearTimeout(revealTimerRef.current);
      clearTimeout(timeoutTimerRef.current);
      clearTimeout(settleTimerRef.current);
    };
  }, [iframeKey]);

  // 加载结束（成功/失败）。gen 用于忽略上一次加载残留的 onLoad/onError
  const settle = (next: LoadStatus, gen: number) => {
    if (loadGenRef.current !== gen) return;
    // 该次加载已被失败信号判定失败：忽略随后 Chromium 错误页触发的 onLoad('loaded')
    if (next === 'loaded' && failedGenRef.current === gen) return;
    // 加载已结束，关掉兜底超时与待显示的进度条
    clearTimeout(timeoutTimerRef.current);
    clearTimeout(revealTimerRef.current);
    // 2s 内就加载完：进度条全程不出现
    if (shownAtRef.current === 0) {
      setStatus(next);
      return;
    }
    // 进度条已显示：保证至少可见 MIN_VISIBLE_MS 再隐藏，避免一闪而过
    const wait = Math.max(0, MIN_VISIBLE_MS - (Date.now() - shownAtRef.current));
    if (wait === 0) {
      setStatus(next);
      return;
    }
    settleTimerRef.current = setTimeout(() => setStatus(next), wait);
  };

  // 订阅主进程上报的 iframe 加载失败（net 错误 / HTTP>=400），即时进入错误态，无需等兜底超时
  useEffect(() => {
    const url = message?.url;
    if (!url) return;
    const gen = loadGenRef.current;
    // 关联失败事件与当前消息：上报 URL 可能被规范化（末尾斜杠/大小写等），
    // 严格相等会漏判；放宽到同源即可命中本页失败，又能排除跨源广告/三方子框架的失败。
    const isThisFrame = (failedUrl: string) => {
      if (failedUrl === url) return true;
      try {
        return new URL(failedUrl).origin === new URL(url).origin;
      } catch {
        return false;
      }
    };
    const off = window.electronAPI.onFrameLoadFail((data) => {
      if (isThisFrame(data.url)) {
        failedGenRef.current = gen;
        settle('error', gen);
      }
    });
    return () => off?.();
  }, [iframeKey]);

  // 自动标已读
  useEffect(() => {
    if (message && !message.read) {
      window.electronAPI.markRead([message.messageId], true);
      useAppStore.getState().updateMessage(message.messageId, { read: true });
    }
  }, [message]);

  if (!message) {
    return (
      <div className="detail-placeholder">
        <svg viewBox="0 0 24 24" width="64" height="64">
          <path
            d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1"
          />
          <polyline points="22,6 12,13 2,6" fill="none" stroke="currentColor" strokeWidth="1" />
        </svg>
        <span>选择一条消息查看详情</span>
      </div>
    );
  }

  return (
    <div className="detail-container">
      {message.url ? (
        <div className="detail-content-area detail-content-frame">
          {showBar && status === 'loading' && (
            <div className="detail-loading-bar" role="progressbar" aria-label="正在加载消息详情">
              <div className="detail-loading-bar-indicator" />
            </div>
          )}
          <iframe
            key={iframeKey}
            className="detail-iframe"
            src={message.url}
            title={message.name}
            sandbox="allow-scripts allow-same-origin allow-popups"
            onLoad={() => settle('loaded', loadGenRef.current)}
            onError={() => settle('error', loadGenRef.current)}
          />
          {status === 'error' && (
            <div className="detail-load-error">
              <div className="detail-load-error-title">网页加载失败</div>
              <div className="detail-load-error-desc">
                可能是网络异常或该页面不允许在应用内打开
              </div>
              <div className="detail-load-error-actions">
                <button
                  className="btn-primary"
                  onClick={() => {
                    isRetryRef.current = true;
                    setRetry((r) => r + 1);
                  }}
                >
                  重新加载
                </button>
                <button
                  className="detail-load-error-link"
                  onClick={() =>
                    window.electronAPI.openExternal(message.url)
                  }
                >
                  在浏览器中打开
                </button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="detail-no-url">
          <div className="detail-title">{message.name}</div>
          {message.summary && <div className="detail-summary-text">{message.summary}</div>}
        </div>
      )}
    </div>
  );
}
