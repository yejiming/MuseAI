import React, { useState, useEffect } from 'react';
import { Layout, Menu, ConfigProvider, Modal, Button } from 'antd';
import { BookOutlined, SettingOutlined, ClearOutlined, ExclamationCircleOutlined, ReadOutlined, ProfileOutlined, GlobalOutlined, MessageOutlined } from '@ant-design/icons';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { warmMinimalistTheme } from '../theme';

const { Sider, Content } = Layout;

const AppShell: React.FC = () => {
  const [permissionRequest, setPermissionRequest] = useState<{requestId: string; command: string} | null>(null);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    const setupListener = async () => {
      const unlisten = await listen<{requestId: string; command: string}>('bash-permission-request', (event) => {
        setPermissionRequest(event.payload);
      });
      return unlisten;
    };
    
    let unlistenFn: (() => void) | undefined;
    setupListener().then(fn => unlistenFn = fn);
    
    return () => {
      if (unlistenFn) unlistenFn();
    };
  }, []);

  const handleMenuClick = ({ key }: { key: string }) => {
    navigate(key);
  };

  const resolvePermission = async (approved: boolean) => {
    if (permissionRequest) {
      try {
        await invoke('resolve_bash_permission', {
          requestId: permissionRequest.requestId,
          approved
        });
      } catch (e) {
        console.error('Failed to resolve bash permission:', e);
      }
      setPermissionRequest(null);
    }
  };

  return (
    <ConfigProvider theme={warmMinimalistTheme}>
      <Layout style={{ minHeight: '100vh' }}>
        <Sider
          collapsed={true}
          collapsedWidth={56}
          theme="light"
          style={{
            borderRight: `1px solid ${warmMinimalistTheme.token?.colorBorder}`,
            paddingTop: '16px',
          }}
        >
          <Menu
            mode="inline"
            selectedKeys={[location.pathname]}
            onClick={handleMenuClick}
            items={[
              {
                key: '/',
                icon: <BookOutlined />,
                label: '作品',
              },
              {
                key: '/outline',
                icon: <ProfileOutlined />,
                label: '大纲',
              },
              {
                key: '/de-ai',
                icon: <ClearOutlined />,
                label: '去AI味',
              },
              {
                key: '/examples',
                icon: <ReadOutlined />,
                label: '范文',
              },
              {
                type: 'divider',
              },
              {
                key: '/background',
                icon: <GlobalOutlined />,
                label: '背景',
              },
              {
                key: '/chat',
                icon: <MessageOutlined />,
                label: '聊天',
              },
              {
                type: 'divider',
              },
              {
                key: '/settings',
                icon: <SettingOutlined />,
                label: '设置',
              },
            ]}
          />
        </Sider>
        <Layout>
          <Content
            style={{
              background: warmMinimalistTheme.components?.Layout?.bodyBg,
              display: 'flex',
              flexDirection: 'column',
              height: '100vh',
              overflow: 'hidden',
            }}
          >
            <Outlet />
          </Content>
        </Layout>
      </Layout>
      <Modal
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <ExclamationCircleOutlined style={{ color: '#faad14' }} />
            <span>执行命令请求</span>
          </div>
        }
        open={!!permissionRequest}
        closable={false}
        maskClosable={false}
        footer={[
          <Button key="deny" onClick={() => resolvePermission(false)}>
            拒绝
          </Button>,
          <Button key="approve" type="primary" danger onClick={() => resolvePermission(true)}>
            允许执行
          </Button>,
        ]}
      >
        <p>AI 助手请求执行以下终端命令，是否允许？</p>
        <div style={{
          background: '#f5f5f5',
          padding: '12px',
          borderRadius: '6px',
          fontFamily: 'monospace',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-all'
        }}>
          {permissionRequest?.command}
        </div>
      </Modal>
    </ConfigProvider>
  );
};

export default AppShell;
