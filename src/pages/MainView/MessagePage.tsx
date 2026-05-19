import { useState, useEffect, useRef, useCallback } from 'react';
import { Settings } from 'lucide-react';
import { useAppStore } from '../../stores/appStore';
import MessageList from './MessageList';
import MessageDetail from './MessageDetail';
import SettingsPage from './SettingsPage';
import type { MessageItem } from '../../types';

export default function MessagePage() {
  const messages = useAppStore((s) => s.messages);
  const loginInfo = useAppStore((s) => s.loginInfo);
  const [selectedMessage, setSelectedMessage] = useState<MessageItem | null>(null);
  const [selectedMessageId, setSelectedMessageId] = useState<number | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [listPaneWidth, setListPaneWidth] = useState(360);
  const isDragging = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleSelectMessage = useCallback((message: MessageItem | null) => {
    setSelectedMessage(message);
    setSelectedMessageId(message?.messageId ?? null);
    if (message) setShowSettings(false);
  }, []);

  const openSettings = useCallback(() => {
    setShowSettings(true);
    handleSelectMessage(null);
  }, [handleSelectMessage]);

  useEffect(() => {
    const handleOpenSettings = () => openSettings();
    const handleShowMessages = () => setShowSettings(false);
    window.addEventListener('app:open-settings', handleOpenSettings);
    window.addEventListener('app:show-messages', handleShowMessages);
    return () => {
      window.removeEventListener('app:open-settings', handleOpenSettings);
      window.removeEventListener('app:show-messages', handleShowMessages);
    };
  }, [openSettings]);

  useEffect(() => {
    if (selectedMessageId === null) {
      if (selectedMessage !== null) {
        setSelectedMessage(null);
      }
      return;
    }

    const nextSelected = messages.find((item) => item.messageId === selectedMessageId) ?? null;
    if (!nextSelected) {
      setSelectedMessage(null);
      setSelectedMessageId(null);
      return;
    }

    if (selectedMessage !== nextSelected) {
      setSelectedMessage(nextSelected);
    }
  }, [messages, selectedMessage, selectedMessageId]);

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
          onSelect={handleSelectMessage}
          selectedMessageId={selectedMessageId}
          onLoadMore={loadMore}
          onRefresh={() => refreshMessages(1)}
        />
        <div className="message-banner">
          <div className="user-avatar">
            {loginInfo?.nickName?.[0] || loginInfo?.uid?.[0] || 'U'}
          </div>
          <div className="user-name">{loginInfo?.nickName || loginInfo?.uid || '用户'}</div>
          <button
            className="banner-settings-btn"
            onClick={openSettings}
            title="设置 (⌘/Ctrl+,)"
            aria-label="设置"
          >
            <Settings size={18} />
          </button>
        </div>
      </div>
      <div className="resize-handle" onMouseDown={handleMouseDown} />
      <div className="detail-pane">
        {showSettings ? <SettingsPage /> : <MessageDetail message={selectedMessage} />}
      </div>
    </div>
  );
}
