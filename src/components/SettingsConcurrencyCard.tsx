import React from 'react';
import { Button, Card, Form, InputNumber, message } from 'antd';
import { defaultAgentConfigs, useSettingsStore } from '../stores/useSettingsStore';

interface SettingsConcurrencyCardProps {
  agentId: string;
  label: string;
  helpText: string;
  saveMessage: string;
}

const CARD_STYLE: React.CSSProperties = {
  backgroundColor: '#ffffff',
  border: '1px solid #eae6df',
  borderRadius: '12px',
  boxShadow: '0 4px 20px rgba(217, 119, 87, 0.02)',
  marginBottom: '24px',
};

const CARD_BODY_STYLE: React.CSSProperties = { padding: '24px' };
const HELP_TEXT_STYLE: React.CSSProperties = { color: '#8c8780', fontSize: '12px' };
const FORM_ITEM_STYLE: React.CSSProperties = { marginBottom: 20 };
const INPUT_STYLE: React.CSSProperties = { width: 180 };
const ACTIONS_STYLE: React.CSSProperties = { display: 'flex', gap: '12px' };
const PRIMARY_BUTTON_STYLE: React.CSSProperties = {
  backgroundColor: '#d97757',
  borderColor: '#d97757',
  color: '#ffffff',
  fontWeight: 500,
  borderRadius: '6px',
};
const SECONDARY_BUTTON_STYLE: React.CSSProperties = {
  borderColor: '#eae6df',
  color: '#5c5751',
  borderRadius: '6px',
};

export const SettingsConcurrencyCard: React.FC<SettingsConcurrencyCardProps> = ({
  agentId,
  label,
  helpText,
  saveMessage,
}) => {
  const store = useSettingsStore();
  const [form] = Form.useForm();
  const concurrency = store.agentConfigs?.[agentId]?.concurrency ?? 5;

  React.useEffect(() => {
    form.setFieldsValue({ concurrency });
  }, [concurrency, form]);

  const handleSave = (values: { concurrency: number }) => {
    store.setAgentConfig(agentId, {
      concurrency: Math.max(1, Math.min(20, values.concurrency || 5)),
    });
    message.success(saveMessage);
  };

  const handleReset = () => {
    const defaultConcurrency = defaultAgentConfigs[agentId]?.concurrency ?? 5;
    form.setFieldsValue({ concurrency: defaultConcurrency });
    store.setAgentConfig(agentId, { concurrency: defaultConcurrency });
    message.success('已恢复默认并发数');
  };

  return (
    <Card style={CARD_STYLE} styles={{ body: CARD_BODY_STYLE }}>
      <Form form={form} layout="vertical" onFinish={handleSave} requiredMark={false}>
        <Form.Item
          label={label}
          name="concurrency"
          help={<span style={HELP_TEXT_STYLE}>{helpText}</span>}
          style={FORM_ITEM_STYLE}
        >
          <InputNumber min={1} max={20} step={1} style={INPUT_STYLE} />
        </Form.Item>
        <div style={ACTIONS_STYLE}>
          <Button
            type="primary"
            htmlType="submit"
            style={PRIMARY_BUTTON_STYLE}
          >
            保存配置
          </Button>
          <Button onClick={handleReset} style={SECONDARY_BUTTON_STYLE}>
            恢复默认
          </Button>
        </div>
      </Form>
    </Card>
  );
};
