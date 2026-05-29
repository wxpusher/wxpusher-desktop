import { useEffect } from 'react';
import { useAppStore } from '../../stores/appStore';
import MessagePage from './MessagePage';
import Toolbar from '../components/Toolbar';
import NotificationBanner from '../components/NotificationBanner';
import PushCheckBanner from '../components/PushCheckBanner';
import AnnouncementBanner from '../components/AnnouncementBanner';
import OnboardingGuide from '../components/OnboardingGuide';
import UpdateModal from '../components/UpdateModal';
import './styles.scss';

export default function MainView() {
  useEffect(() => {
    // WS 新消息监听（P0 修复：返回清理函数）
    const offMsg = window.electronAPI.onNewMessage((msg) => {
      const item = {
        messageId: msg.mid,
        name: msg.name,
        summary: msg.summary,
        url: msg.url,
        sourceUrl: msg.sourceUrl,
        read: false,
        createTime: msg.createTime || Date.now(),
      };
      useAppStore.getState().prependMessages([item]);
    });

    // 通知点击：切回消息视图并在列表中选中该消息（选中后 MessageDetail 会自动标已读）
    const offClick = window.electronAPI.onNotificationClick((messageId) => {
      window.dispatchEvent(new CustomEvent('app:show-messages'));
      window.dispatchEvent(new CustomEvent('app:select-message', { detail: messageId }));
    });

    // 更新状态：写入 store，并决定是否自动弹窗
    const offUpdate = window.electronAPI.onUpdateStatus((status) => {
      const store = useAppStore.getState();
      store.setUpdateStatus(status);
      if (status.phase === 'no-update' || status.phase === 'error') return;
      // 强制：始终弹（阻塞）
      if (status.forceUpdate) {
        store.setUpdateModalOpen(true);
        return;
      }
      // 手动复检：checking/available/downloading/downloaded 都即时弹（用户主动发起）
      if (status.source === 'manual') {
        store.setUpdateModalOpen(true);
        return;
      }
      // silent 后台：仅下载完成时弹一次"重启更新"提醒；且同一版本"当天"被"稍后"抑制时不弹。
      // silent 的 checking/available/downloading 保持安静，仅工具栏气泡显示。
      if (status.phase === 'downloaded') {
        const today = new Date().toISOString().slice(0, 10);
        const dismissedToday =
          status.latestVersion != null &&
          store.updateDismissedVersion === status.latestVersion &&
          store.updateDismissedDate === today;
        if (!dismissedToday) store.setUpdateModalOpen(true);
      }
    });

    // WS 强制更新（msgType 204）：归一到阻塞弹窗
    const offUpdateReq = window.electronAPI.onUpdateRequired((msg) => {
      const m = (msg ?? {}) as Record<string, unknown>;
      const store = useAppStore.getState();
      store.setUpdateStatus({
        phase: 'available',
        source: 'manual',
        currentVersion: store.updateStatus?.currentVersion ?? '',
        title: (m.title as string) || '需要更新',
        content:
          (m.content as string) ||
          (m.msg as string) ||
          '当前版本已不再支持，请更新后继续使用。',
        latestVersion: (m.version as string) || (m.latestVersion as string),
        forceUpdate: true,
      });
      store.setUpdateModalOpen(true);
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
        window.dispatchEvent(new CustomEvent('app:open-settings'));
      }
      // ⌘W 关闭窗口(隐藏到后台,程序继续运行收消息)
      if (isMod && e.key === 'w') {
        e.preventDefault();
        window.electronAPI.closeWindow();
      }
    };

    window.addEventListener('keydown', handleKeydown);
    return () => {
      offMsg?.();
      offClick?.();
      offUpdate?.();
      offUpdateReq?.();
      window.removeEventListener('keydown', handleKeydown);
    };
  }, []);

  return (
    <div className="main-view">
      <Toolbar />
      <NotificationBanner />
      <PushCheckBanner />
      <AnnouncementBanner />
      <div className="main-body">
        <MessagePage />
      </div>
      <OnboardingGuide />
      <UpdateModal />
    </div>
  );
}
