import { useEffect, useMemo, useState } from 'react';
import { useAppStore } from '../../stores/appStore';
import type { MessageItem } from '../../types';

interface Props {
  message: MessageItem | null;
}

export default function MessageDetail({ message }: Props) {
  const [isLoading, setIsLoading] = useState(false);
  const iframeKey = useMemo(() => {
    if (!message) return 'empty';
    return `${message.messageId}:${message.url || ''}`;
  }, [message]);

  useEffect(() => {
    if (!message) {
      setIsLoading(false);
      return;
    }
    setIsLoading(Boolean(message.url));
  }, [message?.messageId, message?.url]);

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
          {isLoading && (
            <div className="detail-loading">
              <div className="detail-loading-title">正在加载消息详情</div>
              <div className="detail-loading-meta">
                {message.name || `#${message.messageId}`}
              </div>
            </div>
          )}
          <iframe
            key={iframeKey}
            className={`detail-iframe ${isLoading ? 'is-loading' : ''}`}
            src={message.url}
            title={message.name}
            sandbox="allow-scripts allow-same-origin allow-popups"
            onLoad={() => setIsLoading(false)}
          />
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
