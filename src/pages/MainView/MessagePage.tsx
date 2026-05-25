import { useState, useEffect, useRef, useCallback } from 'react';
import { Settings } from 'lucide-react';
import { useAppStore } from '../../stores/appStore';
import MessageList from './MessageList';
import MessageDetail from './MessageDetail';
import SettingsPage from './SettingsPage';
import type { MessageItem } from '../../types';

export default function MessagePage() {
  const messages = useAppStore((s) => s.messages);
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
    // 系统通知点击：在列表中选中该消息并加载右侧详情
    const handleSelectFromNotification = (e: Event) => {
      const messageId = (e as CustomEvent<number>).detail;
      const msg = useAppStore
        .getState()
        .messages.find((m) => m.messageId === messageId);
      if (msg) handleSelectMessage(msg);
    };
    window.addEventListener('app:open-settings', handleOpenSettings);
    window.addEventListener('app:show-messages', handleShowMessages);
    window.addEventListener('app:select-message', handleSelectFromNotification);
    return () => {
      window.removeEventListener('app:open-settings', handleOpenSettings);
      window.removeEventListener('app:show-messages', handleShowMessages);
      window.removeEventListener('app:select-message', handleSelectFromNotification);
    };
  }, [openSettings, handleSelectMessage]);

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
    document.body.classList.add('resizing');
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
      document.body.classList.remove('resizing');
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
          <button
            className="banner-brand"
            onClick={() => window.electronAPI.openExternal('https://wxpusher.zjiecode.com')}
            title="访问 WxPusher 官网"
            aria-label="WxPusher 官网"
          >
            WxPusher消息推送平台
          </button>
          <button
            className="banner-settings-btn"
            onClick={openSettings}
            title="设置 (⌘/Ctrl+,)"
            aria-label="设置"
          >
            <Settings size={18} />
          </button>
          <button
            className="banner-settings-btn"
            onClick={() =>
              window.electronAPI.openExternal('https://wxpusher.zjiecode.com/docs/#/')
            }
            title="接入文档"
            aria-label="接入文档"
          >
            {/* 自定义 SVG：打开的书 + 代码尖括号 < >，代表「开发者接入文档」 */}
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              {/* 书本外形（左右两页 + 中缝） */}
              <path d="M3 5.5A1.5 1.5 0 0 1 4.5 4H10a2 2 0 0 1 2 2v14a1.5 1.5 0 0 0-1.5-1.5H3V5.5Z" />
              <path d="M21 5.5A1.5 1.5 0 0 0 19.5 4H14a2 2 0 0 0-2 2v14a1.5 1.5 0 0 1 1.5-1.5H21V5.5Z" />
              {/* 中间的代码尖括号 < / > —— 表达「接入 / 开发文档」 */}
              <path d="M9.5 10.5 8 12l1.5 1.5" />
              <path d="M14.5 10.5 16 12l-1.5 1.5" />
            </svg>
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
