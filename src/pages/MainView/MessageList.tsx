import { useState, useEffect, useRef, useCallback } from 'react';
import { Virtuoso } from 'react-virtuoso';
import { RefreshCw, Trash2, CheckCheck, X, Search } from 'lucide-react';
import { Modal, Spin, message } from 'antd';
import { useAppStore } from '../../stores/appStore';
import { getRelativeDateTime } from '../../utils/time';
import type { MessageItem } from '../../types';

interface Props {
  onSelect: (msg: MessageItem | null) => void;
  selectedMessageId: number | null;
  onLoadMore: () => void;
  onRefresh: () => void;
}

// 刷新按钮旋转一圈的时长（与 global.scss 中 icon-spin 动画周期保持一致）
const SPIN_MS = 800;

export default function MessageList({ onSelect, selectedMessageId, onLoadMore, onRefresh }: Props) {
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
  // P0: 撤销删除 toast 状态
  const [undoToast, setUndoToast] = useState<{
    ids: number[];
    count: number;
    countdown: number;
    timer: NodeJS.Timeout;
  } | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const lastClickedId = useRef<number | null>(null);

  // 刷新按钮旋转状态：点击后旋转，加载完成且至少转满一圈后停止
  const [isSpinning, setIsSpinning] = useState(false);
  const spinStartRef = useRef(0);

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

  // 双击打开新窗口
  const handleDoubleClick = useCallback((msg: MessageItem) => {
    if (msg.url) {
      window.electronAPI.showBrowserView(msg.url);
    }
  }, []);

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
      message.error('操作失败');
    }
  }, []);

  // P0 修复：删除（带 5 秒倒计时 + 撤销按钮）
  const handleDelete = useCallback((ids: number[]) => {
    const store = useAppStore.getState();
    // 取消之前的待确认删除
    if (undoToast) {
      clearTimeout(undoToast.timer);
    }

    // 保存被删除的消息用于撤销恢复
    const deletedMessages = store.messages.filter((m) => ids.includes(m.messageId));

    // 本地立即移除
    store.removeMessages(ids);

    let countdown = 5;
    // 5 秒后真正调用后端删除
    const timer = setTimeout(async () => {
      try {
        await window.electronAPI.deleteMessages(ids);
      } catch {
        // 删除失败，恢复消息
        store.prependMessages(deletedMessages);
      }
      setUndoToast(null);
    }, 5000);

    setUndoToast({ ids, count: ids.length, countdown, timer });

    // 倒计时
    const countdownTimer = setInterval(() => {
      countdown--;
      setUndoToast((prev) => (prev ? { ...prev, countdown } : null));
      if (countdown <= 0) {
        clearInterval(countdownTimer);
      }
    }, 1000);
  }, [undoToast]);

  // 撤销删除
  const handleUndoDelete = useCallback(() => {
    if (!undoToast) return;
    clearTimeout(undoToast.timer);
    // 恢复消息：重新拉取列表
    window.electronAPI
      .getMessageList({ messageId: Number.MAX_SAFE_INTEGER, key: '', scene: 1 })
      .then((data) => {
        useAppStore.getState().setMessages(data || []);
      });
    setUndoToast(null);
  }, [undoToast]);

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
          {!searchMode && <div className="link">为什么我收不到消息？</div>}
        </div>
      )}

      {/* P0: 撤销删除 Toast（5 秒倒计时 + 撤销按钮） */}
      {undoToast && (
        <div className="undo-delete-toast">
          <Trash2 size={16} />
          <span>已删除 {undoToast.count} 条消息</span>
          <button className="undo-btn" onClick={handleUndoDelete}>
            撤销
          </button>
          <span className="countdown">{undoToast.countdown}s</span>
        </div>
      )}

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
                在浏览器中打开
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
