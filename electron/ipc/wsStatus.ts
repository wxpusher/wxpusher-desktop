// WS 连接状态：主进程与渲染进程共享的单一来源（纯常量，无 electron 运行时依赖）
export const WS_STATUS = {
  NotConnect: 'NotConnect',
  Connecting: 'Connecting',
  Connected: 'Connected',
  Closing: 'Closing',
  Offline: 'Offline',
} as const;

export type WsStatusValue = (typeof WS_STATUS)[keyof typeof WS_STATUS];
