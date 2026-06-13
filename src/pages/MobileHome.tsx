import React from 'react';
import { useNavigate } from 'react-router-dom';
import { MessageOutlined, FireOutlined, HeartOutlined, WifiOutlined } from '@ant-design/icons';

const MOBILE_HOME_ENTRY_BUTTON_STYLE: React.CSSProperties = {
  backgroundColor: '#fff',
  borderRadius: '16px',
  padding: '20px',
  display: 'flex',
  alignItems: 'center',
  cursor: 'pointer',
  boxShadow: '0 4px 20px rgba(217, 119, 87, 0.02)',
  border: '1px solid rgba(217, 119, 87, 0.05)',
  transition: 'transform 0.2s',
  width: '100%',
  font: 'inherit',
  textAlign: 'left',
};

const MOBILE_HOME_ENTRY_ICON_STYLE: React.CSSProperties = {
  width: '48px',
  height: '48px',
  borderRadius: '12px',
  backgroundColor: 'rgba(217, 119, 87, 0.1)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  marginRight: '16px',
};

const MobileHome: React.FC = () => {
  const navigate = useNavigate();

  return (
    <div style={{
      padding: '24px',
      backgroundColor: '#faf9f5',
      height: '100%',
      overflowY: 'auto',
      WebkitOverflowScrolling: 'touch',
    }}>
      {/* Welcome & Status */}
      <div style={{
        backgroundColor: '#fff',
        borderRadius: '16px',
        padding: '20px',
        marginBottom: '24px',
        boxShadow: '0 4px 20px rgba(217, 119, 87, 0.04)',
        border: '1px solid rgba(217, 119, 87, 0.05)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: '12px' }}>
          <WifiOutlined style={{ fontSize: '20px', color: '#d97757', marginRight: '8px' }} />
          <span style={{ fontSize: '15px', fontWeight: 600, color: '#33312e' }}>连接状态：已连接</span>
        </div>
        <p style={{ fontSize: '13px', color: '#8c8880', margin: 0, lineHeight: 1.5 }}>
          您已通过局域网成功访问 MuseAI 写作助手。您可以在手机上随时与伴侣畅聊或继续未完的故事冒险，所有更改将实时同步回电脑端。
        </p>
      </div>

      {/* Navigation Cards */}
      <h3 style={{ fontSize: '15px', fontWeight: 600, color: '#33312e', marginBottom: '16px' }}>功能入口</h3>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {/* Chat Entry */}
        <button
          type="button"
          onClick={() => navigate('/chat')}
          style={MOBILE_HOME_ENTRY_BUTTON_STYLE}
        >
          <div style={MOBILE_HOME_ENTRY_ICON_STYLE}>
            <MessageOutlined style={{ fontSize: '22px', color: '#d97757' }} />
          </div>
          <div style={{ flex: 1 }}>
            <h4 style={{ margin: '0 0 4px 0', fontSize: '15px', fontWeight: 600, color: '#33312e' }}>伴侣聊天</h4>
            <p style={{ margin: 0, fontSize: '12px', color: '#8c8880' }}>与您的智能伴侣即时对话，同步生成羁绊记忆。</p>
          </div>
        </button>

        {/* Story Entry */}
        <button
          type="button"
          onClick={() => navigate('/story')}
          style={MOBILE_HOME_ENTRY_BUTTON_STYLE}
        >
          <div style={MOBILE_HOME_ENTRY_ICON_STYLE}>
            <FireOutlined style={{ fontSize: '22px', color: '#d97757' }} />
          </div>
          <div style={{ flex: 1 }}>
            <h4 style={{ margin: '0 0 4px 0', fontSize: '15px', fontWeight: 600, color: '#33312e' }}>故事冒险</h4>
            <p style={{ margin: 0, fontSize: '12px', color: '#8c8880' }}>开启沉浸式文字冒险游戏，由大模型为您主持剧情。</p>
          </div>
        </button>

        {/* Bond Entry */}
        <button
          type="button"
          onClick={() => navigate('/bond')}
          style={MOBILE_HOME_ENTRY_BUTTON_STYLE}
        >
          <div style={MOBILE_HOME_ENTRY_ICON_STYLE}>
            <HeartOutlined style={{ fontSize: '22px', color: '#d97757' }} />
          </div>
          <div style={{ flex: 1 }}>
            <h4 style={{ margin: '0 0 4px 0', fontSize: '15px', fontWeight: 600, color: '#33312e' }}>智能羁绊</h4>
            <p style={{ margin: 0, fontSize: '12px', color: '#8c8880' }}>查看和编辑您的角色卡、关系类型以及关键记忆。</p>
          </div>
        </button>
      </div>
    </div>
  );
};

export default MobileHome;
