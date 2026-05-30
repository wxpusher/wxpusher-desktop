import { create } from 'zustand';
import type { MessageItem, LoginInfo, UpdateStatus } from '../types';
import { WS_STATUS, type WsStatusValue } from '../../electron/ipc/wsStatus';

interface AppState {
  // 认证
  isLogged: boolean;
  loginInfo: LoginInfo | null;

  // WS 状态
  wsStatus: WsStatusValue;

  // 消息列表
  messages: MessageItem[];
  selectedIds: number[];
  searchKeyword: string;
  searchResults: MessageItem[];
  hasMore: boolean;
  isLoading: boolean;
  lastRefreshTime: number;
  totalCount: number | null;
  focusedIndex: number;

  // 主题
  isDarkMode: boolean;

  // 更新
  updateStatus: UpdateStatus | null;
  updateModalOpen: boolean;
  updateDismissedVersion: string | null;
  updateDismissedDate: string | null; // YYYY-MM-DD：仅抑制"当天"对该版本的自动弹窗

  // 偏好
  notifyPermissionDismissedAt: number | null;

  // Actions
  setLogged: (info: LoginInfo) => void;
  updateLoginInfo: (info: Partial<LoginInfo>) => void;
  logout: () => void;
  setWsStatus: (status: WsStatusValue) => void;
  setMessages: (msgs: MessageItem[]) => void;
  appendMessages: (msgs: MessageItem[]) => void;
  prependMessages: (msgs: MessageItem[]) => void;
  updateMessage: (id: number, changes: Partial<MessageItem>) => void;
  removeMessages: (ids: number[]) => void;
  setSelectedIds: (ids: number[]) => void;
  setSearchKeyword: (keyword: string) => void;
  setSearchResults: (results: MessageItem[]) => void;
  setDarkMode: (dark: boolean) => void;
  setFocusedIndex: (index: number) => void;
  setLoading: (loading: boolean) => void;
  setHasMore: (hasMore: boolean) => void;
  setLastRefreshTime: (time: number) => void;
  setNotifyPermissionDismissedAt: (time: number | null) => void;
  setUpdateStatus: (status: UpdateStatus | null) => void;
  setUpdateModalOpen: (open: boolean) => void;
  setUpdateDismissed: (version: string | null, date: string | null) => void;
}

export const useAppStore = create<AppState>((set) => ({
  isLogged: false,
  loginInfo: null,
  wsStatus: WS_STATUS.Connecting,
  messages: [],
  selectedIds: [],
  searchKeyword: '',
  searchResults: [],
  hasMore: true,
  isLoading: false,
  lastRefreshTime: 0,
  totalCount: null,
  focusedIndex: -1,
  isDarkMode: false,
  updateStatus: null,
  updateModalOpen: false,
  updateDismissedVersion: null,
  updateDismissedDate: null,
  notifyPermissionDismissedAt: null,

  setLogged: (info) => set({ isLogged: true, loginInfo: info }),
  updateLoginInfo: (info) => set((s) => ({ loginInfo: s.loginInfo ? { ...s.loginInfo, ...info } : (info as LoginInfo) })),
  logout: () => set({ isLogged: false, loginInfo: null, messages: [], selectedIds: [] }),
  setWsStatus: (status) => set({ wsStatus: status }),
  setMessages: (msgs) => set({ messages: msgs }),
  appendMessages: (msgs) =>
    set((s) => ({ messages: [...s.messages, ...msgs], hasMore: msgs.length >= 20 })),
  prependMessages: (msgs) => set((s) => ({ messages: [...msgs, ...s.messages] })),
  updateMessage: (id, changes) =>
    set((s) => ({
      messages: s.messages.map((m) => (m.messageId === id ? { ...m, ...changes } : m)),
    })),
  removeMessages: (ids) =>
    set((s) => ({
      messages: s.messages.filter((m) => !ids.includes(m.messageId)),
      selectedIds: s.selectedIds.filter((id) => !ids.includes(id)),
    })),
  setSelectedIds: (ids) => set({ selectedIds: ids }),
  setSearchKeyword: (keyword) => set({ searchKeyword: keyword }),
  setSearchResults: (results) => set({ searchResults: results }),
  setDarkMode: (dark) => set({ isDarkMode: dark }),
  setFocusedIndex: (index) => set({ focusedIndex: index }),
  setLoading: (loading) => set({ isLoading: loading }),
  setHasMore: (hasMore) => set({ hasMore }),
  setLastRefreshTime: (time) => set({ lastRefreshTime: time }),
  setNotifyPermissionDismissedAt: (time) => set({ notifyPermissionDismissedAt: time }),
  setUpdateStatus: (status) => set({ updateStatus: status }),
  setUpdateModalOpen: (open) => set({ updateModalOpen: open }),
  setUpdateDismissed: (version, date) =>
    set({ updateDismissedVersion: version, updateDismissedDate: date }),
}));
