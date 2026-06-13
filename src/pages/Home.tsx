import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, Row, Col, Typography, Spin, Tooltip } from 'antd';
import {
  BookOutlined,
  ProfileOutlined,
  ClearOutlined,
  ReadOutlined,
  GlobalOutlined,
  MessageOutlined,
  CompassOutlined,
  HeartOutlined,
  FileTextOutlined,
  FontSizeOutlined,
  FireOutlined,
} from '@ant-design/icons';
import { invoke } from '@tauri-apps/api/core';
import { warmMinimalistTheme } from '../theme';

const { Title, Text } = Typography;

const WEEK_DAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

interface DailyActivity {
  date: string;
  count: number;
}

interface WritingStats {
  totalWorks: number;
  totalWordCount: number;
  dailyActivity: DailyActivity[];
}

const writingModules = [
  { key: '/works', label: '作品', icon: <BookOutlined />, color: '#d97757' },
  { key: '/outline', label: '大纲', icon: <ProfileOutlined />, color: '#d97757' },
  { key: '/de-ai', label: '去AI味', icon: <ClearOutlined />, color: '#d97757' },
  { key: '/examples', label: '范文', icon: <ReadOutlined />, color: '#d97757' },
];

const companionModules = [
  { key: '/background', label: '背景', icon: <GlobalOutlined />, color: '#8b7355' },
  { key: '/chat', label: '聊天', icon: <MessageOutlined />, color: '#8b7355' },
  { key: '/adventure', label: '冒险', icon: <CompassOutlined />, color: '#8b7355' },
  { key: '/bond', label: '羁绊', icon: <HeartOutlined />, color: '#8b7355' },
  { key: '/story', label: '穿书', icon: <CompassOutlined />, color: '#8b7355' },
];

const HOME_STAT_ICON_STYLE: React.CSSProperties = {
  width: 44,
  height: 44,
  borderRadius: 10,
  background: '#f2e8dc',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 20,
  color: '#d97757',
};

const HOME_SECTION_LABEL_STYLE: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: '#8c857b',
  textTransform: 'uppercase',
  letterSpacing: 1,
  display: 'block',
  marginBottom: 16,
  marginTop: 28,
};

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 6) return '夜深了';
  if (hour < 11) return '早上好';
  if (hour < 14) return '中午好';
  if (hour < 18) return '下午好';
  return '晚上好';
}

function formatNumber(n: number): string {
  if (n >= 10000) {
    return `${(n / 10000).toFixed(1)}万`;
  }
  return n.toLocaleString();
}

function getHeatColor(count: number): string {
  if (count === 0) return '#f0ebe3';
  if (count === 1) return '#f2d5c4';
  if (count <= 3) return '#e8a88a';
  return '#d97757';
}

const Home: React.FC = () => {
  const navigate = useNavigate();
  const [stats, setStats] = useState<WritingStats | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const loadStats = async () => {
      try {
        const result: WritingStats = await invoke('get_writing_stats');
        setStats(result);
      } catch (e) {
        console.error('Failed to load writing stats:', e);
      } finally {
        setLoading(false);
      }
    };

    loadStats();
  }, []);

  const today = new Date();
  const dateStr = `${today.getFullYear()}年${today.getMonth() + 1}月${today.getDate()}日`;
  const weekStr = WEEK_DAYS[today.getDay()];

  const activeDays = stats?.dailyActivity.filter((d) => d.count > 0).length ?? 0;

  return (
    <div
      style={{
        padding: '40px 48px',
        height: '100%',
        overflow: 'auto',
        background: warmMinimalistTheme.components?.Layout?.bodyBg,
      }}
    >
      {/* 欢迎区域 */}
      <div style={{ marginBottom: 40 }}>
        <Title level={2} style={{ margin: 0, color: '#33312e', fontWeight: 500 }}>
          {getGreeting()}，欢迎回到 MuseAI
        </Title>
        <Text style={{ color: '#8c857b', fontSize: 15, marginTop: 8, display: 'block' }}>
          今天想创作什么？ &nbsp;·&nbsp; {dateStr} {weekStr}
        </Text>
      </div>

      {/* 创作统计 */}
      <div style={{ marginBottom: 40 }}>
        <Text
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: '#8c857b',
            textTransform: 'uppercase',
            letterSpacing: 1,
            display: 'block',
            marginBottom: 16,
          }}
        >
          创作统计
        </Text>
        <Card
          style={{
            borderRadius: 12,
            border: 'none',
            boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
          }}
          bodyStyle={{ padding: '24px 28px' }}
        >
          {loading ? (
            <div style={{ textAlign: 'center', padding: 40 }}>
              <Spin size="small" />
            </div>
          ) : (
            <>
              {/* 统计数字 */}
              <Row gutter={[48, 24]} style={{ marginBottom: 20 }}>
                <Col>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={HOME_STAT_ICON_STYLE}>
                      <FileTextOutlined />
                    </div>
                    <div>
                      <Text style={{ fontSize: 28, fontWeight: 600, color: '#33312e', lineHeight: 1.2, display: 'block' }}>
                        {formatNumber(stats?.totalWorks ?? 0)}
                      </Text>
                      <Text style={{ fontSize: 12, color: '#b0a99e' }}>作品总数</Text>
                    </div>
                  </div>
                </Col>
                <Col>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={HOME_STAT_ICON_STYLE}>
                      <FontSizeOutlined />
                    </div>
                    <div>
                      <Text style={{ fontSize: 28, fontWeight: 600, color: '#33312e', lineHeight: 1.2, display: 'block' }}>
                        {formatNumber(stats?.totalWordCount ?? 0)}
                      </Text>
                      <Text style={{ fontSize: 12, color: '#b0a99e' }}>总字数</Text>
                    </div>
                  </div>
                </Col>
                <Col>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={HOME_STAT_ICON_STYLE}>
                      <FireOutlined />
                    </div>
                    <div>
                      <Text style={{ fontSize: 28, fontWeight: 600, color: '#33312e', lineHeight: 1.2, display: 'block' }}>
                        {activeDays}
                      </Text>
                      <Text style={{ fontSize: 12, color: '#b0a99e' }}>近30天活跃</Text>
                    </div>
                  </div>
                </Col>
              </Row>

              {/* 30天热力图 */}
              <div>
                <Text style={{ fontSize: 12, color: '#b0a99e', marginBottom: 10, display: 'block' }}>
                  近30天写作活跃度
                </Text>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(15, 1fr)',
                    gap: '4px 4px',
                    maxWidth: 520,
                  }}
                >
                  {stats?.dailyActivity.map((day) => (
                    <Tooltip key={day.date} title={`${day.date} · 修改 ${day.count} 个作品`}>
                      <div
                        style={{
                          width: '100%',
                          aspectRatio: '1',
                          borderRadius: 3,
                          background: getHeatColor(day.count),
                          transition: 'background 0.2s ease, transform 0.2s ease',
                          cursor: 'pointer',
                        }}
                        className="heat-cell"
                      />
                    </Tooltip>
                  )) ?? Array.from({ length: 30 }).map((_, i) => (
                    <div
                      key={i}
                      style={{
                        width: '100%',
                        aspectRatio: '1',
                        borderRadius: 3,
                        background: '#f0ebe3',
                      }}
                    />
                  ))}
                </div>
              </div>
            </>
          )}
        </Card>
      </div>


      {/* 快捷入口卡片 */}
      <div>
        <Text
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: '#8c857b',
            textTransform: 'uppercase',
            letterSpacing: 1,
            display: 'block',
            marginBottom: 16,
          }}
        >
          写作工具
        </Text>
        <Row gutter={[16, 16]}>
          {writingModules.map((mod) => (
            <Col key={mod.key} xs={12} sm={8} md={6} lg={4}>
              <Card
                hoverable
                onClick={() => navigate(mod.key)}
                bodyStyle={{ padding: '20px 16px', textAlign: 'center' }}
                style={{
                  borderRadius: 12,
                  border: 'none',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
                  transition: 'box-shadow 0.25s ease, transform 0.25s ease, border-color 0.25s ease',
                }}
              >
                <div
                  style={{
                    fontSize: 28,
                    color: mod.color,
                    marginBottom: 10,
                    transition: 'transform 0.25s ease',
                  }}
                  className="home-card-icon"
                >
                  {mod.icon}
                </div>
                <Text style={{ fontSize: 14, fontWeight: 500, color: '#33312e' }}>{mod.label}</Text>
              </Card>
            </Col>
          ))}
        </Row>

        <Text style={HOME_SECTION_LABEL_STYLE}>
          智能伴侣
        </Text>
        <Row gutter={[16, 16]}>
          {companionModules.map((mod) => (
            <Col key={mod.key} xs={12} sm={8} md={6} lg={4}>
              <Card
                hoverable
                onClick={() => navigate(mod.key)}
                bodyStyle={{ padding: '20px 16px', textAlign: 'center' }}
                style={{
                  borderRadius: 12,
                  border: 'none',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
                  transition: 'box-shadow 0.25s ease, transform 0.25s ease, border-color 0.25s ease',
                }}
              >
                <div
                  style={{
                    fontSize: 28,
                    color: mod.color,
                    marginBottom: 10,
                    transition: 'transform 0.25s ease',
                  }}
                  className="home-card-icon"
                >
                  {mod.icon}
                </div>
                <Text style={{ fontSize: 14, fontWeight: 500, color: '#33312e' }}>{mod.label}</Text>
              </Card>
            </Col>
          ))}
        </Row>
      </div>

      {/* hover 动画样式 */}
      <style>{`
        .home-card-icon {
          transition: transform 0.25s ease;
        }
        .ant-card:hover .home-card-icon {
          transform: translateY(-3px);
        }
        .heat-cell:hover {
          transform: scale(1.15);
          box-shadow: 0 2px 8px rgba(217, 119, 87, 0.25);
        }
      `}</style>
    </div>
  );
};

export default Home;
