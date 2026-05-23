import { useState, useEffect } from 'react';
import { useAppStore } from '../../stores/appStore';
import type { BannerData } from '../../types';

// 自绘公告广播图标：倾斜喇叭体（柔填充）+ 下垂手柄带 + 右侧扩散弧线。
// 描边/填充都走 currentColor，自动跟随 .notification-banner--info 的主题色。
function AnnouncementIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      {/* 喇叭主体：左窄右宽的倾斜筒，圆角衔接 */}
      <path
        d="M3.5 10.25v3.5a1.5 1.5 0 0 0 1.16 1.46l12 2.83A1.5 1.5 0 0 0 18.5 16.58V7.42a1.5 1.5 0 0 0-1.84-1.46l-12 2.83a1.5 1.5 0 0 0-1.16 1.46Z"
        fill="currentColor"
        fillOpacity="0.18"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      {/* 手柄挂带：从喇叭底部垂下，圆滑收尾 */}
      <path
        d="M7.5 15.25v2a1.75 1.75 0 0 0 3.5 0v-1.6"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* 广播波纹：右侧单道弧，暗示「正在播报」 */}
      <path
        d="M20.8 9.5c1.2 1.6 1.2 3.4 0 5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

// 公告 banner：主进程 AnnouncementBannerManager 每小时拉一次 /api/need-login/device/list-banner，
// 服务端返回有效公告时展示 title/desc，可选 url 走系统浏览器；用户「关闭」按 id 永久隐藏。
// 节流与缓存全在主进程完成（参考 PushCheckBanner），组件只负责取最新状态 + 订阅热更新。
export default function AnnouncementBanner() {
  const isLogged = useAppStore((s) => s.isLogged);
  const [data, setData] = useState<BannerData | null>(null);
  const [closedId, setClosedId] = useState<number | null>(null);

  useEffect(() => {
    // 冷启动：取已落盘的上次结果 + 已关闭的 banner id，避免等本轮请求完成才渲染
    window.electronAPI.getLastListBanner().then((r) => setData(r.lastResult));
    window.electronAPI.getPref('closedBannerId').then((id) => setClosedId((id as number | null) ?? null));
    const off = window.electronAPI.onListBannerResult((r) => setData(r));
    return () => {
      off?.();
    };
  }, []);

  if (!isLogged) return null;
  if (!data) return null;
  if (closedId === data.id) return null;

  const handleClose = () => {
    // 立即 setState 隐藏，避免等 IPC 回写期间 banner 闪烁
    setClosedId(data.id);
    window.electronAPI.setPref('closedBannerId', data.id);
  };

  const handleOpen = () => {
    if (data.url) window.electronAPI.openExternal(data.url);
  };

  return (
    <div className="notification-banner notification-banner--info">
      <AnnouncementIcon />
      <div className="banner-text">
        <strong>{data.title}</strong>
        {data.desc && <span>{data.desc}</span>}
      </div>
      {data.url && <button onClick={handleOpen}>查看</button>}
      <button className="ignore" onClick={handleClose}>
        关闭
      </button>
    </div>
  );
}
