import React, { useMemo } from 'react';
import ReactDOM from 'react-dom/client';
import { App as AntdApp, ConfigProvider, theme } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import App from './App';
import { useAppStore } from './stores/appStore';
import './styles/global.scss';

const lightThemeToken = {
  colorPrimary: '#B300B3',
  colorBgLayout: '#FAFBFE',
  colorBgContainer: '#FFFFFF',
  colorBgElevated: '#F8F9FC',
  colorText: '#1F1F1F',
  colorTextSecondary: '#686868',
  colorBorder: '#EEEEEE',
  borderRadius: 8,
} as const;

const darkThemeToken = {
  colorPrimary: '#DA5ADA',
  colorBgLayout: '#121212',
  colorBgContainer: '#1E1E1E',
  colorBgElevated: '#252525',
  colorText: '#E8E8E8',
  colorTextSecondary: '#999999',
  colorBorder: '#3A3A3A',
  borderRadius: 8,
} as const;

function Root() {
  const isDarkMode = useAppStore((s) => s.isDarkMode);

  const antdTheme = useMemo(
    () => ({
      algorithm: isDarkMode ? theme.darkAlgorithm : theme.defaultAlgorithm,
      token: isDarkMode ? darkThemeToken : lightThemeToken,
    }),
    [isDarkMode]
  );

  return (
    <ConfigProvider locale={zhCN} theme={antdTheme}>
      <AntdApp message={{ duration: 2 }}>
        <App />
      </AntdApp>
    </ConfigProvider>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
);
