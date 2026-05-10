import { useNavigate, useLocation } from 'react-router-dom';
import { Mail, Store, Settings, ChevronsLeft, ChevronsRight } from 'lucide-react';
import { useAppStore } from '../../stores/appStore';

const navItems = [
  { path: '/messages', icon: Mail, label: '消息' },
  { path: '/market', icon: Store, label: '消息市场' },
  { path: '/settings', icon: Settings, label: '设置' },
];

export default function Sidebar() {
  const sidebarCollapsed = useAppStore((s) => s.sidebarCollapsed);
  const loginInfo = useAppStore((s) => s.loginInfo);
  const navigate = useNavigate();
  const location = useLocation();

  const currentPath = location.pathname;

  return (
    <div className={`sidebar ${sidebarCollapsed ? 'collapsed' : ''}`}>
      <div className="sidebar-user" onClick={() => navigate('/settings')}>
        <div className="user-avatar">
          {loginInfo?.nickName?.[0] || loginInfo?.uid?.[0] || 'U'}
        </div>
        {!sidebarCollapsed && (
          <div className="user-name">{loginInfo?.nickName || loginInfo?.uid || '用户'}</div>
        )}
      </div>

      <div className="sidebar-nav">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = currentPath.startsWith(item.path);
          return (
            <div
              key={item.path}
              className={`nav-item ${isActive ? 'active' : ''}`}
              onClick={() => navigate(item.path)}
              tabIndex={0}
              onKeyDown={(e) => e.key === 'Enter' && navigate(item.path)}
            >
              <Icon size={18} />
              {!sidebarCollapsed && <span>{item.label}</span>}
            </div>
          );
        })}
      </div>

      <div className="sidebar-footer">
        <button
          className="collapse-btn"
          onClick={() => useAppStore.getState().toggleSidebar()}
          title={`${sidebarCollapsed ? '展开' : '折叠'}侧边栏 (⌘/Ctrl+\\)`}
        >
          {sidebarCollapsed ? <ChevronsRight size={16} /> : <ChevronsLeft size={16} />}
        </button>
      </div>
    </div>
  );
}
