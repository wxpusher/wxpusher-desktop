import { useEffect } from 'react';
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { useAppStore } from '../../stores/appStore';
import Sidebar from './Sidebar';
import MessagePage from './MessagePage';
import MarketPage from './MarketPage';
import SettingsPage from './SettingsPage';
import Toolbar from '../components/Toolbar';
import NotificationBanner from '../components/NotificationBanner';
import OnboardingGuide from '../components/OnboardingGuide';
import ToastContainer from '../components/ToastContainer';
import './styles.scss';

export default function MainView() {
  const sidebarCollapsed = useAppStore((s) => s.sidebarCollapsed);
  const navigate = useNavigate();

  useEffect(() => {
    // WS 新消息监听（P0 修复：返回清理函数）
    const offMsg = window.electronAPI.onNewMessage((msg) => {
      const item = {
        messageId: msg.mid,
        name: msg.title,
        summary: msg.summary,
        url: msg.url,
        sourceUrl: msg.sourceUrl,
        read: false,
        createTime: msg.createTime || Date.now(),
      };
      useAppStore.getState().prependMessages([item]);
    });

    // 通知点击
    const offClick = window.electronAPI.onNotificationClick((messageId) => {
      navigate('/messages');
      useAppStore.getState().updateMessage(messageId, { read: true });
    });

    // 键盘快捷键
    const handleKeydown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;

      const isMod = e.metaKey || e.ctrlKey;

      if (isMod && e.key === 'r' && !e.shiftKey) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('app:refresh'));
      }
      if (isMod && e.key === 'f') {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('app:focus-search'));
      }
      if (isMod && e.key === ',') {
        e.preventDefault();
        navigate('/settings');
      }
      if (isMod && e.key === '\\') {
        e.preventDefault();
        useAppStore.getState().toggleSidebar();
      }
      // P0: ⌘W 遵循关闭行为设置
      if (isMod && e.key === 'w') {
        e.preventDefault();
        window.electronAPI.closeWindow();
      }
    };

    window.addEventListener('keydown', handleKeydown);
    return () => {
      offMsg?.();
      offClick?.();
      window.removeEventListener('keydown', handleKeydown);
    };
  }, [navigate]);

  return (
    <div className={`main-view ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
      <Toolbar />
      <NotificationBanner />
      <div className="main-body">
        <Sidebar />
        <div className="main-content">
          <Routes>
            <Route index element={<Navigate to="messages" replace />} />
            <Route path="messages" element={<MessagePage />} />
            <Route path="market" element={<MarketPage />} />
            <Route path="settings" element={<SettingsPage />} />
          </Routes>
        </div>
      </div>
      <OnboardingGuide />
      <ToastContainer />
    </div>
  );
}
