import { useState, useEffect, useRef, useCallback } from 'react';
import { useAppStore } from '../../stores/appStore';
import MessageList from './MessageList';
import MessageDetail from './MessageDetail';
import type { MessageItem } from '../../types';

export default function MessagePage() {
  const [selectedMessage, setSelectedMessage] = useState<MessageItem | null>(null);
  const [listPaneWidth, setListPaneWidth] = useState(360);
  const isDragging = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // 初始加载
  useEffect(() => {
    refreshMessages(2); // SceneAutoRefresh
  }, []);

  // 监听刷新事件
  useEffect(() => {
    const handleRefresh = () => refreshMessages(1);
    window.addEventListener('app:refresh', handleRefresh);
    return () => window.removeEventListener('app:refresh', handleRefresh);
  }, []);

  const refreshMessages = async (scene: number) => {
    const store = useAppStore.getState();
    store.setLoading(true);
    try {
      const data = await window.electronAPI.getMessageList({
        messageId: Number.MAX_SAFE_INTEGER,
        key: '',
        scene,
      });
      if (scene === 1) {
        // 手动刷新：替换
        store.setMessages(data || []);
      } else {
        store.setMessages(data || []);
      }
      store.setLastRefreshTime(Date.now());
    } catch (e) {
      console.error('刷新消息失败:', e);
    } finally {
      store.setLoading(false);
    }
  };

  const loadMore = useCallback(async () => {
    const store = useAppStore.getState();
    if (!store.hasMore || store.isLoading) return;
    const lastId = store.messages[store.messages.length - 1]?.messageId;
    if (!lastId) return;
    store.setLoading(true);
    try {
      const data = await window.electronAPI.getMessageList({
        messageId: lastId,
        key: '',
        scene: 5,
      });
      store.appendMessages(data || []);
    } catch (e) {
      console.error('加载更多失败:', e);
    } finally {
      store.setLoading(false);
    }
  }, []);

  // 拖拽调整分栏宽度
  const handleMouseDown = useCallback(() => {
    isDragging.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const newWidth = e.clientX - rect.left;
      setListPaneWidth(Math.max(280, Math.min(600, newWidth)));
    };

    const handleMouseUp = () => {
      isDragging.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  return (
    <div className="message-page" ref={containerRef}>
      <div className="list-pane" style={{ width: listPaneWidth }}>
        <MessageList
          onSelect={setSelectedMessage}
          onLoadMore={loadMore}
          onRefresh={() => refreshMessages(1)}
        />
      </div>
      <div className="resize-handle" onMouseDown={handleMouseDown} />
      <div className="detail-pane">
        <MessageDetail message={selectedMessage} />
      </div>
    </div>
  );
}
