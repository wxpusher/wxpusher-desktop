import { session, app } from 'electron';
import { PreferencesManager } from '../managers/PreferencesManager';

export function setupCsp(): void {
  const isDev = !app.isPackaged;

  // 主窗口 CSP（dev 模式放宽以支持 Vite HMR）
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const csp = isDev
      ? "default-src 'self' 'unsafe-inline' 'unsafe-eval' ws: http://localhost:* https:; script-src 'self' 'unsafe-inline' 'unsafe-eval' http://localhost:*; style-src 'self' 'unsafe-inline'; img-src 'self' data: https: http:; frame-src 'self' https: http:"
      : "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; frame-src 'self' https:";
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
