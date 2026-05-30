import { useEffect, useState } from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAppStore } from './stores/appStore';
import LoginView from './pages/LoginView';
import MainView from './pages/MainView';

function LoginRoute() {
  const isLogged = useAppStore((s) => s.isLogged);
  if (isLogged) return <Navigate to="/" replace />;
  return <LoginView />;
}

function App() {
  const isLogged = useAppStore((s) => s.isLogged);
  const isDarkMode = useAppStore((s) => s.isDarkMode);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // 检查凭证，完成后才渲染路由
    window.electronAPI.getCredential().then((cred) => {
      if (cred?.deviceToken) {
        useAppStore.getState().setLogged(cred);
        window.electronAPI.wsConnect(cred.pushToken);
        // 获取完整用户信息（uid、spt 等）
        window.electronAPI.getUserDeviceInfo().then((info) => {
          if (info) {
            useAppStore.getState().updateLoginInfo(info);
          }
        }).catch(() => {});
      }
    }).finally(() => {
      setReady(true);
    });

    // 主题
    window.electronAPI.getTheme().then((dark) => useAppStore.getState().setDarkMode(dark));
    const offTheme = window.electronAPI.onThemeChanged((dark) =>
      useAppStore.getState().setDarkMode(dark)
    );

    // WS 状态（监听变更 + 同步当前状态）
    const offWs = window.electronAPI.onWsStatus((status) =>
      useAppStore.getState().setWsStatus(status)
    );
    window.electronAPI.isWsConnected().then((connected) => {
      if (connected) useAppStore.getState().setWsStatus('Connected');
    });

    // 认证过期
    const offAuth = window.electronAPI.onAuthExpired(() => useAppStore.getState().logout());

    // 更新弹窗「稍后」的抑制：恢复 版本+日期，仅用于抑制"当天"对该版本的自动弹窗
    Promise.all([
      window.electronAPI.getPref('updateDismissedVersion'),
      window.electronAPI.getPref('updateDismissedDate'),
    ]).then(([version, date]) => {
      if (version) useAppStore.getState().setUpdateDismissed(version as string, (date as string) ?? null);
    });

    // P0 修复：清理所有 IPC 监听器
    return () => {
      offTheme?.();
      offWs?.();
      offAuth?.();
    };
  }, []);

  // 与设计 token（html.dark）保持一致，驱动自定义 SCSS 的 CSS 变量
  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDarkMode);
  }, [isDarkMode]);

  if (!ready) return <div className="app" />;

  return (
    <div className="app">
      <HashRouter>
        <Routes>
          <Route path="/login" element={<LoginRoute />} />
          <Route
            path="/*"
            element={isLogged ? <MainView /> : <Navigate to="/login" replace />}
          />
        </Routes>
      </HashRouter>
    </div>
  );
}

export default App;
