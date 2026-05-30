import React from 'react';
import { Empty } from 'antd';
import { MessageOutlined } from '@ant-design/icons';

const Chat: React.FC = () => {
  return (
    <div style={{ 
      display: 'flex', 
      height: '100%', 
      width: '100%', 
      alignItems: 'center', 
      justifyContent: 'center', 
      background: '#faf9f5' 
    }}>
      <Empty
        image={<MessageOutlined style={{ fontSize: 64, color: '#d97757', opacity: 0.8 }} />}
        description={
          <div style={{ fontFamily: '"Inter", sans-serif', color: '#33312e' }}>
            <h3 style={{ fontSize: 18, fontWeight: 500, margin: '8px 0' }}>伴侣聊天室</h3>
            <p style={{ color: '#8c8882', fontSize: 14 }}>伴侣对话功能正在火热开发中，敬请期待！</p>
          </div>
        }
      />
    </div>
  );
};

export default Chat;
