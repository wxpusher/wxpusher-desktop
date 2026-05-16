import { WS_STATUS, type WsStatusValue } from '../../electron/ipc/wsStatus';

export interface WsStatusDisplay {
  text: string;
  tone: 'online' | 'connecting' | 'offline';
  tip: string;
}

export const WS_STATUS_DISPLAY: Record<WsStatusValue, WsStatusDisplay> = {
  [WS_STATUS.Connected]: { text: '已连接', tone: 'online', tip: '实时连接正常' },
  [WS_STATUS.Connecting]: { text: '连接中…', tone: 'connecting', tip: '正在建立连接' },
  [WS_STATUS.NotConnect]: { text: '重连中…', tone: 'connecting', tip: '连接已断开，正在自动重连' },
  [WS_STATUS.Closing]: { text: '重连中…', tone: 'connecting', tip: '连接关闭中' },
  [WS_STATUS.Offline]: { text: '网络已断开', tone: 'offline', tip: '网络不可用，恢复后将自动重连' },
};
