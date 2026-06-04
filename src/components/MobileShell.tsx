import React from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { HomeOutlined, MessageOutlined, FireOutlined, HeartOutlined } from '@ant-design/icons';

const MobileShell: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const currentPath = location.pathname;

  const navItems = [
    { key: '/', label: '首页', icon: <HomeOutlined /> },
    { key: '/chat', label: '聊天', icon: <MessageOutlined /> },
    { key: '/story', label: '冒险', icon: <FireOutlined /> },
    { key: '/bond', label: '羁绊', icon: <HeartOutlined /> },
  ];

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
        {navItems.map((item) => {
          const isActive = currentPath === item.key;
          return (
            <div
              key={item.key}
              onClick={() => navigate(item.key)}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                flex: 1,
                height: '100%',
                cursor: 'pointer',
                color: isActive ? '#d97757' : '#8c8880',
                transition: 'color 0.2s ease',
              }}
            >
              <div style={{ fontSize: '20px', marginBottom: '2px' }}>
                {item.icon}
              </div>
              <span style={{ fontSize: '11px', fontWeight: isActive ? 600 : 400 }}>
                {item.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default MobileShell;
