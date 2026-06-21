import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MessageOutlined, FireOutlined, HeartOutlined, WifiOutlined } from '@ant-design/icons';
import { appInvoke, clearMobileToken, getMobileToken, setMobileToken } from '../utils/runtime';
import { usePartnerChatStore } from '../stores/usePartnerChatStore';
import { usePartnerStore } from '../stores/usePartnerStore';
import { useStoryStore } from '../stores/useStoryStore';
import type { AgentSessionSummary } from '../stores/useAgentStore';

type ConnectionStatus = 'waiting' | 'verifying' | 'verified' | 'invalid';

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
  const [tokenInput, setTokenInput] = useState('');
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('waiting');
  const isVerified = connectionStatus === 'verified';
  const isVerifying = connectionStatus === 'verifying';

  const verifyToken = useCallback(async (token: string) => {
    const normalizedToken = token.trim();
    if (!normalizedToken) {
      setConnectionStatus('waiting');
      return;
    }

    setConnectionStatus('verifying');
    setMobileToken(normalizedToken);

    try {
      await Promise.all([
        usePartnerStore.persist.rehydrate(),
        usePartnerChatStore.persist.rehydrate(),
        useStoryStore.persist.rehydrate(),
      ]);
      const [chatSessions, storySessions] = await Promise.all([
        appInvoke<AgentSessionSummary[]>('list_agent_sessions', {
          prefix: 'partner-session-',
        }),
        appInvoke<AgentSessionSummary[]>('list_agent_sessions', {
          prefix: 'story-session-',
          sessionKind: 'story',
        }),
      ]);
      usePartnerChatStore.getState().setSessions(chatSessions);
      useStoryStore.getState().setSessions(storySessions);
      setConnectionStatus('verified');
    } catch {
      clearMobileToken();
      setConnectionStatus('invalid');
    }
  }, []);

  useEffect(() => {
    const existingToken = getMobileToken();
    if (existingToken) {
      setTokenInput(existingToken);
      void verifyToken(existingToken);
    }
  }, [verifyToken]);

  const statusText = {
    waiting: '连接状态：等待验证',
    verifying: '连接状态：正在验证…',
    verified: '连接状态：已验证',
    invalid: '连接状态：验证失败',
  }[connectionStatus];

  const entryButtonStyle: React.CSSProperties = {
    ...MOBILE_HOME_ENTRY_BUTTON_STYLE,
    cursor: isVerified ? 'pointer' : 'not-allowed',
    opacity: isVerified ? 1 : 0.52,
  };

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
          <WifiOutlined style={{ fontSize: '20px', color: isVerified ? '#52c41a' : '#d97757', marginRight: '8px' }} />
          <output aria-live="polite" style={{ fontSize: '15px', fontWeight: 600, color: '#33312e' }}>
            {statusText}
          </output>
        </div>
        <p style={{ fontSize: '13px', color: '#8c8880', margin: 0, lineHeight: 1.5 }}>
          {isVerified
            ? '访问令牌验证成功。您可以在手机上与伴侣畅聊或继续故事冒险，所有更改将同步回电脑端。'
            : '请输入电脑端设置页面显示的访问令牌，验证通过后即可使用移动端功能。'}
        </p>
        {!isVerified && (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void verifyToken(tokenInput);
            }}
            style={{ marginTop: '16px' }}
          >
            <label htmlFor="mobile-access-token" style={{ display: 'block', marginBottom: '6px', fontSize: '13px', fontWeight: 600, color: '#5c5751' }}>
              访问令牌
            </label>
            <input
              id="mobile-access-token"
              type="password"
              value={tokenInput}
              onChange={(event) => {
                setTokenInput(event.target.value);
                if (connectionStatus === 'invalid') {
                  setConnectionStatus('waiting');
                }
              }}
              disabled={isVerifying}
              autoComplete="off"
              placeholder="粘贴访问令牌"
              className={`mobile-token-input${connectionStatus === 'invalid' ? ' mobile-token-input--invalid' : ''}`}
            />
            {connectionStatus === 'invalid' && (
              <p role="alert" style={{ margin: '7px 0 0', color: '#b33a3a', fontSize: '12px' }}>
                访问令牌无效，请检查后重试
              </p>
            )}
            <button
              type="submit"
              disabled={isVerifying || !tokenInput.trim()}
              className="mobile-token-submit"
            >
              {isVerifying ? '正在验证…' : '验证并连接'}
            </button>
          </form>
        )}
      </div>

      {/* Navigation Cards */}
      <h3 style={{ fontSize: '15px', fontWeight: 600, color: '#33312e', marginBottom: '16px' }}>功能入口</h3>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {/* Chat Entry */}
        <button
          type="button"
          disabled={!isVerified}
          onClick={() => navigate('/chat')}
          style={entryButtonStyle}
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
          disabled={!isVerified}
          onClick={() => navigate('/story')}
          style={entryButtonStyle}
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
          disabled={!isVerified}
          onClick={() => navigate('/bond')}
          style={entryButtonStyle}
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
