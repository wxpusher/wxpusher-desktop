import { useEffect } from 'react';
import { useAppStore } from '../../stores/appStore';
import type { MessageItem } from '../../types';

interface Props {
  message: MessageItem | null;
}

export default function MessageDetail({ message }: Props) {
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
        <iframe
          className="detail-iframe"
          src={message.url}
          title={message.name}
          sandbox="allow-scripts allow-same-origin allow-popups"
        />
      ) : (
        <div className="detail-no-url">
          <div className="detail-title">{message.name}</div>
          {message.summary && <div className="detail-summary-text">{message.summary}</div>}
        </div>
      )}
    </div>
  );
}
