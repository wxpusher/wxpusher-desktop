import { contextBridge, ipcRenderer } from 'electron';

const wxPusherApi = {
  getPlatform: () => 'desktop',
  showToast: (msg?: string) => {
    ipcRenderer.invoke('bridge:show-toast', msg);
  },
  toLoginPage: () => {
    ipcRenderer.invoke('bridge:to-login-page');
  },
  getLoginInfo: (): Promise<any> => {
    return ipcRenderer.invoke('bridge:get-login-info');
  },
  getEnvBaseUrl: (): Promise<{ apiBaseUrl?: string; appFeBaseUrl?: string }> => {
    return ipcRenderer.invoke('bridge:get-env-base-url');
  },
  openUrl: (url: string) => {
    ipcRenderer.invoke('bridge:open-url', url);
  },
  openPageByRoute: (route: string) => {
    ipcRenderer.invoke('bridge:open-page-by-route', route);
  },
  payRequest: (): Promise<{ success: boolean; message: string }> => {
    return Promise.resolve({ success: false, message: '桌面端不支持支付，请在手机端完成' });
  },
  setWebOptionMenu: (visible?: boolean, options?: string[]): Promise<void> => {
    return ipcRenderer.invoke('bridge:set-web-option-menu', { visible, options });
  },
  setWebBottomBarVisible: (visible?: boolean): Promise<void> => {
    return ipcRenderer.invoke('bridge:set-web-bottom-bar', { visible });
  },
};

contextBridge.exposeInMainWorld('wxPusherApi', wxPusherApi);
