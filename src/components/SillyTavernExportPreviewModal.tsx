import React from 'react';
import { Modal, Button, Spin, Typography, Tag, Descriptions, Alert, Space } from 'antd';
import { CheckOutlined, ReloadOutlined } from '@ant-design/icons';

const { Text, Paragraph } = Typography;

export interface SillyTavernCardPreviewData {
  name: string;
  description: string;
  personality: string;
  scenario: string;
  first_mes: string;
  mes_example: string;
  creator_notes: string;
  alternate_greetings: string[];
  tags: string[];
  character_book: {
    name?: string;
    entries: unknown[];
  };
}

function parsePreviewData(cardJson: string): SillyTavernCardPreviewData | null {
  try {
    const card = JSON.parse(cardJson);
    const data = card.data ?? card;
    return {
      name: data.name ?? card.name ?? '',
      description: data.description ?? card.description ?? '',
      personality: data.personality ?? card.personality ?? '',
      scenario: data.scenario ?? card.scenario ?? '',
      first_mes: data.first_mes ?? card.first_mes ?? '',
      mes_example: data.mes_example ?? card.mes_example ?? '',
      creator_notes: data.creator_notes ?? card.creator_notes ?? '',
      alternate_greetings: data.alternate_greetings ?? card.alternate_greetings ?? [],
      tags: data.tags ?? card.tags ?? [],
      character_book: data.character_book ?? card.character_book ?? { entries: [] },
    };
  } catch {
    return null;
  }
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + '……';
}

interface SillyTavernExportPreviewModalProps {
  open: boolean;
  cardJson: string | null;
  loading: boolean;
  error: string | null;
  onConfirm: () => void;
  onRetry: () => void;
  onCancel: () => void;
}

export const SillyTavernExportPreviewModal: React.FC<SillyTavernExportPreviewModalProps> = ({
  open,
  cardJson,
  loading,
  error,
  onConfirm,
  onRetry,
  onCancel,
}) => {
  const preview = cardJson ? parsePreviewData(cardJson) : null;

  return (
    <Modal
      open={open}
      onCancel={onCancel}
      title="SillyTavern 角色卡预览"
      width={680}
      centered
      destroyOnClose
      footer={
        loading ? null : error ? (
          <Space>
            <Button onClick={onCancel}>关闭</Button>
            <Button type="primary" icon={<ReloadOutlined />} onClick={onRetry}>
              重新转换
            </Button>
          </Space>
        ) : (
          <Space>
            <Button onClick={onCancel}>取消</Button>
            <Button icon={<ReloadOutlined />} onClick={onRetry}>
              重新转换
            </Button>
            <Button type="primary" icon={<CheckOutlined />} onClick={onConfirm}>
              确认导出
            </Button>
          </Space>
        )
      }
    >
      {loading && (
        <div style={{ textAlign: 'center', padding: '48px 0' }}>
          <Spin size="large" />
          <div style={{ marginTop: 16, color: '#8c8882' }}>
            正在调用大模型转换角色卡，请稍候……
          </div>
        </div>
      )}

      {!loading && error && (
        <Alert
          type="error"
          message="转换失败"
          description={error}
          showIcon
          style={{ margin: '16px 0' }}
        />
      )}

      {!loading && !error && preview && (
        <div style={{ maxHeight: '60vh', overflowY: 'auto', paddingRight: 8 }}>
          <Descriptions
            column={1}
            size="small"
            bordered
            labelStyle={{
              width: 120,
              background: '#faf9f5',
              color: '#8c8882',
              fontSize: 13,
            }}
            contentStyle={{ fontSize: 13, color: '#33312e' }}
            items={[
              {
                key: 'name',
                label: '角色名',
                children: <Text strong>{preview.name}</Text>,
              },
              {
                key: 'tags',
                label: '标签',
                children: (
                  <Space size={4} wrap>
                    {preview.tags.map((tag, i) => (
                      <Tag key={i} style={{ fontSize: 11 }}>{tag}</Tag>
                    ))}
                  </Space>
                ),
              },
              {
                key: 'description',
                label: '描述',
                children: (
                  <Paragraph style={{ whiteSpace: 'pre-wrap', margin: 0 }}>
                    {truncate(preview.description, 500)}
                  </Paragraph>
                ),
              },
              {
                key: 'personality',
                label: '性格',
                children: truncate(preview.personality, 200),
              },
              {
                key: 'scenario',
                label: '场景',
                children: truncate(preview.scenario, 200),
              },
              {
                key: 'first_mes',
                label: '开场白',
                children: (
                  <Paragraph style={{ whiteSpace: 'pre-wrap', margin: 0 }}>
                    {truncate(preview.first_mes, 300)}
                  </Paragraph>
                ),
              },
              {
                key: 'mes_example',
                label: '对话示例',
                children: (
                  <Paragraph style={{ whiteSpace: 'pre-wrap', margin: 0, fontSize: 12 }}>
                    {truncate(preview.mes_example, 400)}
                  </Paragraph>
                ),
              },
              {
                key: 'greetings',
                label: '备用开场',
                children: `${preview.alternate_greetings.length} 段`,
              },
              {
                key: 'book',
                label: '世界书条目',
                children: `${preview.character_book.entries?.length ?? 0} 条`,
              },
            ]}
          />
          <div style={{ marginTop: 12, color: '#b4afa7', fontSize: 12 }}>
            以上为关键字段摘要，完整内容将在导出的 JSON 文件中呈现。
          </div>
        </div>
      )}
    </Modal>
  );
};
