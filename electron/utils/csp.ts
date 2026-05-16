import { session, app } from 'electron';
import { PreferencesManager } from '../managers/PreferencesManager';
import { WindowManager } from '../managers/WindowManager';
import { IPC_CHANNELS } from '../ipc/ipcChannels';

export function setupCsp(): void {
  const isDev = !app.isPackaged;

  // 详情 iframe(subFrame) 网络层失败检测：
  // - 真实 net 错误（DNS/连接/断网/超时）→ onErrorOccurred（ERR_ABORTED 是正常中止，忽略）
  // - HTTP 错误状态（如 502/404/500，did-fail-load 不触发）→ onCompleted status>=400
  // 复用 IFRAME_LOAD_FAIL 通道，渲染层据此即时进入失败界面（见 MessageDetail）。
  const reportFrameFail = (url: string, errorCode: number, errorDescription: string) => {
    WindowManager.sendToRenderer(IPC_CHANNELS.IFRAME_LOAD_FAIL, {
      url,
      errorCode,
      errorDescription,
    });
  };
  session.defaultSession.webRequest.onErrorOccurred((details) => {
    if (details.resourceType === 'subFrame' && details.error !== 'net::ERR_ABORTED') {
      reportFrameFail(details.url, -1, details.error);
    }
  });
  session.defaultSession.webRequest.onCompleted((details) => {
    if (details.resourceType === 'subFrame' && details.statusCode >= 400) {
      reportFrameFail(details.url, details.statusCode, `HTTP ${details.statusCode}`);
    }
  });

  // 主窗口 CSP（dev 模式放宽以支持 Vite HMR）
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const csp = isDev
      ? "default-src 'self' 'unsafe-inline' 'unsafe-eval' ws: http://localhost:* https:; script-src 'self' 'unsafe-inline' 'unsafe-eval' http://localhost:* https://static.zjiecode.com https://wxpusher.zjiecode.com http://wxpusher.test.zjiecode.com https://sdk.51.la; style-src 'self' 'unsafe-inline'; img-src 'self' data: https: http:; frame-src 'self' https: http:"
      : "default-src 'self'; script-src 'self' https://static.zjiecode.com https://wxpusher.zjiecode.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; frame-src 'self' https:";
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [csp],
      },
    });
  });

  // WebView session：允许 appFeUrl 域名
  const webViewSession = session.fromPartition('persist:webview');
  webViewSession.webRequest.onHeadersReceived((details, callback) => {
    const config = PreferencesManager.getConfig();
    const allowedOrigins = [
      config.appFeUrl,
      config.baseUrl,
      'https://wxpusher.zjiecode.com',
    ];
    const isAllowed = allowedOrigins.some((origin) => details.url.startsWith(origin));
    if (isAllowed) {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [
            `default-src 'self' ${config.appFeUrl}; script-src 'self' 'unsafe-inline' ${config.appFeUrl}; style-src 'self' 'unsafe-inline' ${config.appFeUrl}; img-src 'self' data: ${config.appFeUrl}`,
          ],
        },
      });
    } else {
      callback({ responseHeaders: details.responseHeaders });
    }
  });
}
