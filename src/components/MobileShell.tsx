import React from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { HomeOutlined, MessageOutlined, FireOutlined, HeartOutlined } from '@ant-design/icons';

const MOBILE_NAV_ITEMS = [
  { key: '/', label: '首页', icon: <HomeOutlined /> },
  { key: '/chat', label: '聊天', icon: <MessageOutlined /> },
  { key: '/story', label: '冒险', icon: <FireOutlined /> },
  { key: '/bond', label: '羁绊', icon: <HeartOutlined /> },
];

const MOBILE_NAV_BUTTON_STYLE: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  flex: 1,
  height: '100%',
  cursor: 'pointer',
  transition: 'color 0.2s ease',
  border: 0,
  background: 'transparent',
  padding: 0,
  font: 'inherit',
};

const MobileShell: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const currentPath = location.pathname;

  return (
    <div className="mobile-shell" data-testid="mobile-shell">
      {/* Top Header */}
      <div className="mobile-shell__header">
        {currentPath === '/' && 'MuseAI - 移动端'}
        {currentPath === '/chat' && '伴侣聊天'}
        {currentPath === '/story' && '故事冒险'}
        {currentPath === '/bond' && '智能羁绊'}
      </div>

      {/* Main Content Area */}
      <div className="mobile-shell__content">
        <Outlet />
      </div>

      {/* Bottom Navigation */}
      <div className="mobile-shell__nav">
        {MOBILE_NAV_ITEMS.map((item) => {
          const isActive = currentPath === item.key;
          return (
            <button
              key={item.key}
              type="button"
              aria-label={item.label}
              aria-current={isActive ? 'page' : undefined}
              onClick={() => navigate(item.key)}
              style={{ ...MOBILE_NAV_BUTTON_STYLE, color: isActive ? '#d97757' : '#8c8880' }}
            >
              <div style={{ fontSize: '20px', marginBottom: '2px' }}>
                {item.icon}
              </div>
              <span style={{ fontSize: '11px', fontWeight: isActive ? 600 : 400 }}>
                {item.label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default MobileShell;
