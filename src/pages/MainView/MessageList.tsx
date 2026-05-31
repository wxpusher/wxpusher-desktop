import { useState, useEffect, useRef, useCallback } from 'react';
import { Virtuoso } from 'react-virtuoso';
import { RefreshCw, Trash2, CheckCheck, X, Search } from 'lucide-react';
import { Spin, App, Modal, Alert, Button } from 'antd';
import { useAppStore } from '../../stores/appStore';
import { getRelativeDateTime } from '../../utils/time';
import type { MessageItem, PushCheckOutcome, SendTestOutcome } from '../../types';

interface Props {
  onSelect: (msg: MessageItem | null) => void;
  selectedMessageId: number | null;
  onLoadMore: () => void;
  onRefresh: () => void;
}

// 刷新按钮旋转一圈的时长（与 global.scss 中 icon-spin 动画周期保持一致）
const SPIN_MS = 800;

export default function MessageList({ onSelect, selectedMessageId, onLoadMore, onRefresh }: Props) {
  const { message, modal } = App.useApp();
  const messages = useAppStore((s) => s.messages);
  const selectedIds = useAppStore((s) => s.selectedIds);
  const isLoading = useAppStore((s) => s.isLoading);
  const lastRefreshTime = useAppStore((s) => s.lastRefreshTime);
  const hasMore = useAppStore((s) => s.hasMore);

  const [searchMode, setSearchMode] = useState(false);
  const [searchKeyword, setSearchKeyword] = useState('');
  const [searchResults, setSearchResults] = useState<MessageItem[]>([]);
  const [hasSearched, setHasSearched] = useState(false);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    msg: MessageItem;
  } | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const lastClickedId = useRef<number | null>(null);

  // 刷新按钮旋转状态：点击后旋转，加载完成且至少转满一圈后停止
  const [isSpinning, setIsSpinning] = useState(false);
  const spinStartRef = useRef(0);

  // 「为什么我收不到消息？」弹窗：静态科普 + 打开时实时跑一次 no-msg-check
  const [helpOpen, setHelpOpen] = useState(false);
  const [pushChecking, setPushChecking] = useState(false);
  const [pushCheck, setPushCheck] = useState<PushCheckOutcome | null>(null);

  const openHelp = useCallback(async () => {
    setHelpOpen(true);
    setPushCheck(null);
    setPushChecking(true);
    try {
      setPushCheck(await window.electronAPI.checkNoMsg());
    } catch {
      setPushCheck({ status: 'error' });
    } finally {
      setPushChecking(false);
    }
  }, []);

  // 发送测试消息：验证消息接收链路是否正常
  const [sendingTest, setSendingTest] = useState(false);
  const handleSendTest = useCallback(async () => {
    setSendingTest(true);
    try {
      let outcome: SendTestOutcome;
      try {
        outcome = await window.electronAPI.sendTestMessage();
      } catch {
        outcome = { status: 'error' };
      }
      if (outcome.status === 'not-logged-in') {
        message.warning('登录状态已失效，请重新登录后再试');
      } else if (outcome.status === 'error') {
        message.error(`测试消息发送失败：${outcome.msg || '请稍后重试'}`, 5);
      } else {
        message.success('测试消息已发送，请留意消息列表与通知栏');
      }
    } finally {
      setSendingTest(false);
    }
  }, [message]);

  const handleRefresh = () => {
    if (isSpinning) return; // 防止旋转中重复触发
    spinStartRef.current = Date.now();
    setIsSpinning(true);
    onRefresh();
  };

  useEffect(() => {
    if (isSpinning && !isLoading) {
      const elapsed = Date.now() - spinStartRef.current;
      const remaining = Math.max(0, SPIN_MS - elapsed);
      const t = setTimeout(() => setIsSpinning(false), remaining);
      return () => clearTimeout(t);
    }
  }, [isSpinning, isLoading]);

  // 执行搜索
  const doSearch = useCallback(async (keyword: string) => {
    console.log('[Search] doSearch called, keyword:', keyword);
    if (!keyword.trim()) {
      setSearchResults([]);
      setHasSearched(false);
      return;
    }
    setHasSearched(true);
    try {
      const data = await window.electronAPI.getMessageList({
        messageId: Number.MAX_SAFE_INTEGER,
        key: keyword.trim(),
        scene: 4,
      });
      console.log('[Search] results:', data?.length, 'items');
      setSearchResults(data || []);
    } catch (err) {
      console.error('[Search] error:', err);
      setSearchResults([]);
    }
  }, []);

  // 退出搜索模式，刷新消息列表
  const exitSearch = useCallback(() => {
    setSearchMode(false);
    setSearchKeyword('');
    setSearchResults([]);
    setHasSearched(false);
    onRefresh();
  }, [onRefresh]);

  // 聚焦搜索框
  useEffect(() => {
    const handler = () => {
      setSearchMode(true);
      setTimeout(() => searchInputRef.current?.focus(), 100);
    };
    window.addEventListener('app:focus-search', handler);
    return () => window.removeEventListener('app:focus-search', handler);
  }, []);

  // 点击消息
  const handleMessageClick = useCallback(
    (msg: MessageItem, e: React.MouseEvent) => {
      const store = useAppStore.getState();

      if (e.shiftKey && lastClickedId.current !== null) {
        // Shift+Click: 范围选择
        const list = searchMode ? searchResults : messages;
        const start = list.findIndex((m) => m.messageId === lastClickedId.current);
        const end = list.findIndex((m) => m.messageId === msg.messageId);
        const range = list.slice(Math.min(start, end), Math.max(start, end) + 1);
        const newIds = [...new Set([...store.selectedIds, ...range.map((m) => m.messageId)])];
        store.setSelectedIds(newIds);
      } else if (e.metaKey || e.ctrlKey) {
        // ⌘/Ctrl+Click: 切换选择
        const newIds = store.selectedIds.includes(msg.messageId)
          ? store.selectedIds.filter((id) => id !== msg.messageId)
          : [...store.selectedIds, msg.messageId];
        store.setSelectedIds(newIds);
      } else {
        // 普通点击
        onSelect(msg);
        store.setSelectedIds([]);
      }
      lastClickedId.current = msg.messageId;
    },
    [messages, searchResults, searchMode, onSelect]
  );

  // 双击不执行动作，避免误触打开外链
  const handleDoubleClick = useCallback((_msg: MessageItem) => {}, []);

  // 右键菜单
  const handleContextMenu = useCallback(
    (e: React.MouseEvent, msg: MessageItem) => {
      e.preventDefault();
      setContextMenu({ x: e.clientX, y: e.clientY, msg });
    },
    []
  );

  // 关闭右键菜单
  useEffect(() => {
    const handler = () => setContextMenu(null);
    window.addEventListener('click', handler);
    return () => window.removeEventListener('click', handler);
  }, []);

  // 标已读
  const handleMarkRead = useCallback(async (ids: number[], read: boolean) => {
    const store = useAppStore.getState();
    ids.forEach((id) => store.updateMessage(id, { read }));
    try {
      await window.electronAPI.markRead(ids, read);
    } catch {
      // 失败回滚乐观更新（标记是布尔翻转，回滚即取反）
      ids.forEach((id) => store.updateMessage(id, { read: !read }));
      message.error('标记失败，请稍后重试', 5);
    }
  }, [message]);

  // 删除消息：确认弹窗 → 确认后直接删除
  const handleDelete = useCallback((ids: number[]) => {
    if (ids.length === 0) return;
    modal.confirm({
      title: '删除消息',
      content: `确定删除选中的 ${ids.length} 条消息？删除后不可恢复。`,
      okText: '删除',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: async () => {
        const store = useAppStore.getState();
        const deleted = store.messages.filter((m) => ids.includes(m.messageId));
        store.removeMessages(ids); // 同时会清掉 selectedIds 中的对应项
        try {
          await window.electronAPI.deleteMessages(ids);
        } catch {
          store.prependMessages(deleted); // 删除失败：恢复消息
          message.error('删除失败，请稍后重试', 5);
        }
      },
    });
  }, [message, modal]);

  // 键盘导航
  useEffect(() => {
    const handleKeydown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
        if (e.key === 'Escape') {
          exitSearch();
        }
        return;
      }

      const list = searchMode ? searchResults : messages;
      if (!list.length) return;

      const currentIndex = list.findIndex((m) => m.messageId === selectedMessageId);

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          {
            const next = Math.min(currentIndex + 1, list.length - 1);
            onSelect(list[next]);
          }
          break;
        case 'ArrowUp':
          e.preventDefault();
          {
            const prev = Math.max(currentIndex - 1, 0);
            onSelect(list[prev]);
          }
          break;
        case 'Enter':
          e.preventDefault();
          if (currentIndex >= 0) {
            onSelect(list[currentIndex]);
          }
          break;
        case 'a':
          if (e.metaKey || e.ctrlKey) {
            e.preventDefault();
            useAppStore.getState().setSelectedIds(list.map((m) => m.messageId));
          }
          break;
        case 'Delete':
        case 'Backspace':
          if (selectedIds.length > 0) {
            handleDelete([...selectedIds]);
          }
          break;
        case 'Escape':
          useAppStore.getState().setSelectedIds([]);
          break;
      }

      // P0: ⌘⇧R 标已读 / ⌘⇧U 标未读
      if ((e.metaKey || e.ctrlKey) && e.shiftKey) {
        if (e.key === 'R' || e.key === 'r') {
          e.preventDefault();
          if (selectedIds.length > 0) {
            handleMarkRead([...selectedIds], true);
          }
        }
        if (e.key === 'U' || e.key === 'u') {
          e.preventDefault();
          if (selectedIds.length > 0) {
            handleMarkRead([...selectedIds], false);
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeydown);
    return () => window.removeEventListener('keydown', handleKeydown);
  }, [selectedMessageId, messages, searchResults, searchMode, selectedIds, onSelect, handleDelete]);

  // 搜索模式下：已执行搜索时显示结果，否则保持显示原列表
  const displayList = hasSearched ? searchResults : messages;

  return (
    <div className="message-list-container">
      {/* 列表头 */}
      <div className="list-header">
        {searchMode ? (
          <div className="search-header">
            <div className="search-input-wrapper">
              <input
                ref={searchInputRef}
                className="search-input"
                placeholder="搜索消息内容、发送方"
                value={searchKeyword}
                onChange={(e) => setSearchKeyword(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') doSearch(searchKeyword);
                  if (e.key === 'Escape') exitSearch();
                }}
                autoFocus
              />
              {searchKeyword && (
                <button
                  className="search-clear-btn"
                  onClick={() => {
                    setSearchKeyword('');
                    setSearchResults([]);
                    setHasSearched(false);
                    searchInputRef.current?.focus();
                  }}
                >
                  <X size={12} />
                </button>
              )}
            </div>
            <button className="search-cancel-btn" onClick={exitSearch}>
              取消
            </button>
          </div>
        ) : (
          <div className="list-header-row">
            <span className="list-title">消息列表</span>
            <div className="list-header-actions">
              <span className="refresh-time">
                {lastRefreshTime ? `更新于 ${getRelativeDateTime(lastRefreshTime)}` : ''}
              </span>
              <button
                className={`icon-btn${isSpinning ? ' spinning' : ''}`}
                onClick={handleRefresh}
                title="刷新 (⌘/Ctrl+R)"
              >
                <RefreshCw size={14} />
              </button>
              <button
                className="icon-btn"
                onClick={() => setSearchMode(true)}
                title="搜索 (⌘/Ctrl+F)"
              >
                <Search size={14} />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 多选操作条 */}
      {selectedIds.length > 0 && (
        <div className="selection-bar">
          <span>已选中 {selectedIds.length} 条</span>
          <button onClick={() => handleMarkRead([...selectedIds], true)}>
            <CheckCheck size={14} />
            全部已读
          </button>
          <button onClick={() => handleDelete([...selectedIds])}>
            <Trash2 size={14} />
            删除
          </button>
          <button className="cancel" onClick={() => useAppStore.getState().setSelectedIds([])}>
            取消
          </button>
        </div>
      )}

      {/* 消息列表 */}
      {displayList.length > 0 ? (
        <Virtuoso
          className="app-scrollbar message-list-scroll"
          style={{ flex: 1, minHeight: 0 }}
          data={displayList}
          endReached={searchMode ? undefined : onLoadMore}
          overscan={200}
          components={{
            Footer: () =>
              !searchMode ? (
                hasMore && isLoading ? (
                  <div className="list-loading-footer">
                    <Spin size="small" />
                    <span>加载中...</span>
                  </div>
                ) : !hasMore && displayList.length > 0 ? (
                  <div className="list-loading-footer">只保留最近7天数据，已经加载完成</div>
                ) : null
              ) : null,
          }}
          itemContent={(index, msg) => (
            <div
              key={msg.messageId}
              className={`msg-item ${msg.messageId === selectedMessageId ? 'active' : ''} ${selectedIds.includes(msg.messageId) ? 'selected' : ''}`}
              onClick={(e) => handleMessageClick(msg, e)}
              onDoubleClick={() => handleDoubleClick(msg)}
              onContextMenu={(e) => handleContextMenu(e, msg)}
              tabIndex={0}
            >
              {selectedIds.length > 0 && (
                <div
                  className={`msg-checkbox ${selectedIds.includes(msg.messageId) ? 'checked' : ''}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleMessageClick(msg, e);
                  }}
                />
              )}
              <div className={msg.read ? 'msg-read-dot' : 'msg-unread-dot'} />
              <div className="msg-body">
                <div className="msg-summary">{msg.summary}</div>
                <div className="msg-footer">
                  <span className="msg-source">{msg.name}</span>
                  <span className="msg-id">#{msg.messageId}</span>
                  <span className="msg-time">{getRelativeDateTime(msg.createTime)}</span>
                </div>
              </div>
            </div>
          )}
        />
      ) : (
        <div className="empty-state">
          <svg viewBox="0 0 24 24" width="64" height="64">
            <path
              d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"
              fill="none"
              stroke="currentColor"
              strokeWidth="1"
            />
            <polyline
              points="22,6 12,13 2,6"
              fill="none"
              stroke="currentColor"
              strokeWidth="1"
            />
          </svg>
          <div className="title">{searchMode ? '没有匹配的消息' : '暂无消息'}</div>
          {!searchMode && (
            <div className="link" onClick={openHelp}>
              为什么我收不到消息？
            </div>
          )}
        </div>
      )}

      {/* 「为什么我收不到消息？」弹窗：静态科普 + 实时检测 */}
      <Modal
        open={helpOpen}
        title="为什么我收不到消息？"
        onCancel={() => setHelpOpen(false)}
        centered
        width={460}
        footer={[
          <Button
            key="contact"
            onClick={() => window.electronAPI.openExternal('https://wxpusher.zjiecode.com/contact.html')}
          >
            联系我们
          </Button>,
          <Button
            key="docs"
            onClick={() => window.electronAPI.openExternal('https://wxpusher.zjiecode.com/docs/#/')}
          >
            帮助文档
          </Button>,
          <Button key="ok" type="primary" onClick={() => setHelpOpen(false)}>
            我知道了
          </Button>,
        ]}
      >
        <div className="no-msg-help">
          <div className="title">接收消息需要满足以下条件，任一不满足都可能收不到：</div>
          <ul>
            <li>已订阅至少一个消息源（应用或主题）；未订阅不会有任何消息。</li>
            <li>消息总开关已开启；关闭后将拒收所有消息。</li>
            <li>本设备的推送提醒已开启；关闭后列表仍能收到消息，但不会有通知提醒。</li>
            <li>未超出推送数量上限；达到上限后列表与通知栏都不再接收，每天 24 点自动恢复。</li>
            <li>未超出通知栏提醒数量上限；达到上限后列表仍能收到，但不再弹出通知，每天 24 点自动恢复。</li>
            <li>订阅的消息源近 72 小时内有发送消息；长期没有新消息时列表自然为空。</li>
          </ul>
          <div className="send-test">
            <Button type="primary" loading={sendingTest} onClick={handleSendTest}>
              发送测试消息
            </Button>
            <span className="hint">向当前账号发送一条测试消息，验证消息接收是否正常。</span>
          </div>
          <div className="check-result">
            {pushChecking ? (
              <div className="checking">
                <Spin size="small" />
                <span>正在检测当前推送状态…</span>
              </div>
            ) : pushCheck?.status === 'ok' && pushCheck.result && pushCheck.result.code !== 0 ? (
              <Alert type="warning" showIcon message={pushCheck.result.reason} />
            ) : pushCheck?.status === 'ok' ? (
              <Alert
                type="success"
                showIcon
                message="当前没有检测到异常，可能是你的订阅还没有发送消息，你可以稍等一段时间再试试。"
              />
            ) : pushCheck?.status === 'not-logged-in' ? (
              <Alert type="info" showIcon message="登录状态已失效，请重新登录后再检查。" />
            ) : pushCheck?.status === 'error' ? (
              <Alert type="info" showIcon message="网络异常，本次检测失败，可稍后重试。" />
            ) : null}
          </div>
        </div>
      </Modal>

      {/* 右键菜单 */}
      {contextMenu && (
        <div
          className="context-menu"
          style={{ position: 'fixed', left: contextMenu.x, top: contextMenu.y, zIndex: 9999 }}
        >
          <div
            className="context-menu-item"
            onClick={() =>
              handleMarkRead([contextMenu.msg.messageId], !contextMenu.msg.read)
            }
          >
            <CheckCheck size={14} />
            {contextMenu.msg.read ? '标为未读' : '标为已读'}
          </div>
          <div className="context-menu-divider" />
          <div
            className="context-menu-item danger"
            onClick={() => handleDelete([contextMenu.msg.messageId])}
          >
            <Trash2 size={14} />
            删除
          </div>
          <div className="context-menu-divider" />
          <div
            className="context-menu-item"
            onClick={() => {
              navigator.clipboard.writeText(contextMenu.msg.summary);
              message.success('已复制');
            }}
          >
            复制摘要
          </div>
          {contextMenu.msg.url && (
            <div
              className="context-menu-item"
              onClick={() => window.electronAPI.openExternal(contextMenu.msg.url)}
            >
              在浏览器中打开
            </div>
          )}
          {contextMenu.msg.sourceUrl && (
            <>
              <div
                className="context-menu-item"
                onClick={() => {
                  navigator.clipboard.writeText(contextMenu.msg.sourceUrl);
                  message.success('已复制');
                }}
              >
                复制原始 URL
              </div>
              <div
                className="context-menu-item"
                onClick={() => window.electronAPI.openExternal(contextMenu.msg.sourceUrl)}
              >
                在浏览器中打开原始 URL
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
