import React from 'react';
import { Form, Input, Button, InputNumber, Divider, Typography, Select, message, Anchor, Card } from 'antd';
import { SettingOutlined, BookOutlined, DeploymentUnitOutlined, SafetyCertificateOutlined, AlertOutlined } from '@ant-design/icons';
import {
  useSettingsStore,
  defaultSystemPrompt,
  defaultDeAiDetectorPrompt,
  defaultDeAiRemoverPrompt,
  defaultWorkSummaryPrompt,
  defaultOutlineCreationPrompt,
  defaultOutlineAssessmentPrompt,
} from '../stores/useSettingsStore';

const { Title } = Typography;
const { TextArea } = Input;

const MODEL_PROVIDER_PRESETS = [
  { provider: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", interface: "OpenAI-compatible" },
  { provider: "Zhipu GLM", baseUrl: "https://open.bigmodel.cn/api/paas/v4", interface: "OpenAI-compatible" },
  { provider: "Zhipu GLM en", baseUrl: "https://api.z.ai/v1", interface: "OpenAI-compatible" },
  { provider: "Bailian", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", interface: "OpenAI-compatible" },
  { provider: "Kimi", baseUrl: "https://api.moonshot.cn/v1", interface: "OpenAI-compatible" },
  { provider: "Kimi For Coding", baseUrl: "https://api.kimi.com/coding", interface: "Anthropic-compatible" },
  { provider: "StepFun", baseUrl: "https://api.stepfun.ai/v1", interface: "OpenAI-compatible" },
  { provider: "Minimax", baseUrl: "https://api.minimaxi.com/v1", interface: "OpenAI-compatible" },
  { provider: "Minimax en", baseUrl: "https://platform.minimax.io", interface: "OpenAI-compatible" },
  { provider: "DouBaoSeed", baseUrl: "https://ark.cn-beijing.volces.com/api/v3", interface: "OpenAI-compatible" },
  { provider: "Xiaomi MiMo", baseUrl: "https://api.xiaomimimo.com/v1", interface: "OpenAI-compatible" },
  { provider: "ModelScope", baseUrl: "https://api-inference.modelscope.cn/v1", interface: "OpenAI-compatible" },
  { provider: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", interface: "OpenAI-compatible" },
  { provider: "Ollama", baseUrl: "http://localhost:11434/v1", interface: "OpenAI-compatible" },
  { provider: "Custom", baseUrl: "", interface: "OpenAI-compatible" },
];

const modelInterfaceOptions = [
  { id: "OpenAI-compatible", label: "OpenAI 兼容" },
  { id: "Anthropic-compatible", label: "Anthropic 兼容" },
];

const effortLevelOptions = [
  { id: "off", label: "关闭" },
  { id: "low", label: "低" },
  { id: "medium", label: "中" },
  { id: "high", label: "高" },
];

// Reusable elegant configuration card for each Agent
interface AgentSettingCardProps {
  title: string;
  agentId: string;
  defaultPrompt: string;
  currentPrompt: string;
  onSavePrompt: (prompt: string) => void;
  onResetPrompt: () => void;
  helpText: string;
}

const AgentSettingCard: React.FC<AgentSettingCardProps> = ({
  title,
  agentId,
  defaultPrompt,
  currentPrompt,
  onSavePrompt,
  onResetPrompt,
  helpText,
}) => {
  const store = useSettingsStore();
  const [form] = Form.useForm();
  const agentConfig = store.agentConfigs?.[agentId] || {
    temperature: 0.7,
    maxOutputTokens: 4096,
    maxContextTokens: 128000,
    thinkingDepth: 'off'
  };

  React.useEffect(() => {
    form.setFieldsValue({
      temperature: agentConfig.temperature ?? 0.7,
      maxOutputTokens: agentConfig.maxOutputTokens ?? 4096,
      maxContextTokens: agentConfig.maxContextTokens ?? 128000,
      thinkingDepth: agentConfig.thinkingDepth ?? 'off',
      prompt: currentPrompt,
    });
  }, [agentConfig, currentPrompt]);

  const handleSave = (values: any) => {
    store.setAgentConfig(agentId, {
      temperature: values.temperature,
      maxOutputTokens: values.maxOutputTokens,
      maxContextTokens: values.maxContextTokens,
      thinkingDepth: values.thinkingDepth,
    });
    onSavePrompt(values.prompt);
    message.success(`已保存 ${title} 配置`);
  };

  const handleReset = () => {
    form.setFieldsValue({
      temperature: 0.7,
      maxOutputTokens: 4096,
      maxContextTokens: 128000,
      thinkingDepth: 'off',
      prompt: defaultPrompt,
    });
    store.setAgentConfig(agentId, {
      temperature: 0.7,
      maxOutputTokens: 4096,
      maxContextTokens: 128000,
      thinkingDepth: 'off',
    });
    onResetPrompt();
    message.success(`已恢复 ${title} 默认配置`);
  };

  return (
    <Card
      style={{
        backgroundColor: '#ffffff',
        border: '1px solid #eae6df',
        borderRadius: '12px',
        boxShadow: '0 4px 20px rgba(217, 119, 87, 0.02)',
        marginBottom: '24px',
        transition: 'transform 0.3s ease, box-shadow 0.3s ease'
      }}
      styles={{
        header: {
          borderBottom: '1px solid #f2eee8',
          padding: '16px 24px',
          fontWeight: 600
        },
        body: {
          padding: '24px'
        }
      }}
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#33312e' }}>
          <DeploymentUnitOutlined style={{ color: '#d97757' }} />
          <span>{title}</span>
        </div>
      }
    >
      <Form
        form={form}
        layout="vertical"
        onFinish={handleSave}
        requiredMark={false}
      >
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '16px', marginBottom: '20px' }}>
          <Form.Item label="温度 (Temperature)" name="temperature" style={{ marginBottom: 0 }}>
            <InputNumber min={0} max={2} step={0.1} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item label="最大输出 Token" name="maxOutputTokens" style={{ marginBottom: 0 }}>
            <InputNumber min={1} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item label="最大上下文 Token" name="maxContextTokens" style={{ marginBottom: 0 }}>
            <InputNumber min={1} step={1024} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item label="思考深度 (Depth)" name="thinkingDepth" style={{ marginBottom: 0 }}>
            <Select
              style={{ width: '100%' }}
              options={effortLevelOptions.map((opt) => ({ value: opt.id, label: opt.label }))}
            />
          </Form.Item>
        </div>

        <Form.Item
          label="系统提示词 (System Prompt)"
          name="prompt"
          help={<span style={{ color: '#8c8780', fontSize: '12px' }}>{helpText}</span>}
          style={{ marginBottom: '24px' }}
        >
          <TextArea
            rows={8}
            placeholder={`请输入 ${title} 的系统提示词...`}
            style={{
              resize: 'none',
              backgroundColor: '#faf9f5',
              border: '1px solid #eae6df',
              borderRadius: '8px',
              color: '#33312e',
              fontSize: '14px',
              fontFamily: 'SFMono-Regular, Consolas, "Liberation Mono", Menlo, Courier, monospace'
            }}
          />
        </Form.Item>

        <div style={{ display: 'flex', gap: '12px' }}>
          <Button
            type="primary"
            htmlType="submit"
            style={{
              backgroundColor: '#d97757',
              borderColor: '#d97757',
              color: '#ffffff',
              fontWeight: 500,
              borderRadius: '6px'
            }}
          >
            保存配置
          </Button>
          <Button
            onClick={handleReset}
            style={{
              borderColor: '#eae6df',
              color: '#5c5751',
              borderRadius: '6px'
            }}
          >
            恢复默认
          </Button>
        </div>
      </Form>
    </Card>
  );
};

const Settings: React.FC = () => {
  const store = useSettingsStore();
  const [globalForm] = Form.useForm();

  React.useEffect(() => {
    globalForm.setFieldsValue({
      llmProvider: store.llmProvider,
      modelInterface: store.modelInterface,
      llmModel: store.llmModel,
      llmBaseUrl: store.llmBaseUrl,
      llmApiKey: store.llmApiKey,
    });
  }, [store]);

  const handleSaveGlobalConfig = (values: any) => {
    store.setLlmConfig({
      llmProvider: values.llmProvider,
      modelInterface: values.modelInterface,
      llmModel: values.llmModel,
      llmBaseUrl: values.llmBaseUrl,
      llmApiKey: values.llmApiKey,
    });
    message.success('已保存全局模型设置');
  };

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden', background: '#faf9f5' }}>
      {/* 左侧侧边菜单栏 */}
      <div style={{
        width: 180,
        padding: '40px 0 40px 24px',
        borderRight: '1px solid #eae6df',
        overflowY: 'auto',
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        gap: '8px'
      }}>
        <Anchor
          affix={false}
          getContainer={() => document.getElementById('settings-scroll-container') as HTMLElement}
          onClick={(e) => e.preventDefault()}
          items={[
            { key: 'model-config', href: '#model-config', title: '模型设置' },
          ]}
        />
        <Divider style={{ margin: '12px 16px 12px -8px', borderColor: '#eae6df', minWidth: 'auto', width: 'calc(100% - 8px)' }} />
        <Anchor
          affix={false}
          getContainer={() => document.getElementById('settings-scroll-container') as HTMLElement}
          onClick={(e) => e.preventDefault()}
          items={[
            { key: 'works-config', href: '#works-config', title: '作品页设置' },
            { key: 'outline-config', href: '#outline-config', title: '大纲页设置' },
            { key: 'deai-config', href: '#deai-config', title: '去AI味页设置' },
          ]}
        />
      </div>

      {/* 右侧核心内容区域 */}
      <div id="settings-scroll-container" style={{ flex: 1, padding: '40px 48px', overflowY: 'auto', paddingBottom: 120 }}>
        <div style={{ maxWidth: 800, margin: '0 auto' }}>
          
          <Title level={2} style={{ fontWeight: 600, color: '#33312e', marginBottom: 40, letterSpacing: '-0.5px' }}>
            设置
          </Title>

          {/* 全局模型配置区域 */}
          <section id="model-config" style={{ marginBottom: 48 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '24px' }}>
              <SettingOutlined style={{ fontSize: '20px', color: '#d97757' }} />
              <Title level={4} style={{ color: '#33312e', margin: 0, fontWeight: 600 }}>全局模型设置</Title>
            </div>
            
            <Card
              style={{
                backgroundColor: '#ffffff',
                border: '1px solid #eae6df',
                borderRadius: '12px',
                boxShadow: '0 4px 20px rgba(217, 119, 87, 0.02)',
              }}
              styles={{ body: { padding: '24px' } }}
            >
              <Form
                form={globalForm}
                layout="vertical"
                onFinish={handleSaveGlobalConfig}
                requiredMark={false}
              >
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 24px' }}>
                  <Form.Item label="模型服务商 (Provider)" name="llmProvider">
                    <Select
                      onChange={(value) => {
                        const preset = MODEL_PROVIDER_PRESETS.find((p) => p.provider === value);
                        if (preset && preset.provider !== "Custom") {
                          globalForm.setFieldsValue({
                            llmBaseUrl: preset.baseUrl,
                            modelInterface: preset.interface,
                          });
                        }
                      }}
                      options={MODEL_PROVIDER_PRESETS.map((p) => ({ value: p.provider, label: p.provider }))}
                    />
                  </Form.Item>
                  <Form.Item label="接口类型 (Interface Type)" name="modelInterface">
                    <Select
                      options={modelInterfaceOptions.map((opt) => ({ value: opt.id, label: opt.label }))}
                    />
                  </Form.Item>

                  <Form.Item label="模型名称 (Model)" name="llmModel">
                    <Input placeholder="例如: gpt-4o, claude-3-5-sonnet" />
                  </Form.Item>
                  <Form.Item label="接口地址 (Base URL)" name="llmBaseUrl">
                    <Input placeholder="https://api.openai.com/v1" />
                  </Form.Item>
                </div>

                <Form.Item label="模型 API Key (API Key)" name="llmApiKey" style={{ marginBottom: '24px' }}>
                  <Input.Password placeholder="sk-..." />
                </Form.Item>

                <Form.Item style={{ marginBottom: 0 }}>
                  <Button
                    type="primary"
                    htmlType="submit"
                    size="large"
                    style={{
                      backgroundColor: '#d97757',
                      borderColor: '#d97757',
                      color: '#ffffff',
                      fontWeight: 500,
                      borderRadius: '6px',
                      padding: '0 32px'
                    }}
                  >
                    保存全局设置
                  </Button>
                </Form.Item>
              </Form>
            </Card>
          </section>

          <Divider style={{ borderColor: '#eae6df', margin: '48px 0' }} />

          {/* 作品页设置区域 */}
          <section id="works-config" style={{ marginBottom: 48 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '24px' }}>
              <BookOutlined style={{ fontSize: '20px', color: '#d97757' }} />
              <Title level={4} style={{ color: '#33312e', margin: 0, fontWeight: 600 }}>作品页设置</Title>
            </div>

            <AgentSettingCard
              title="写文章 Agent"
              agentId="writer"
              defaultPrompt={defaultSystemPrompt}
              currentPrompt={store.systemPrompt}
              onSavePrompt={store.setSystemPrompt}
              onResetPrompt={store.resetSystemPrompt}
              helpText="此提示词将作为作品页写文章 Agent 初始化和长短篇创作时的核心人设设定与行为约束。"
            />

            <AgentSettingCard
              title="作品总结 Agent"
              agentId="workSummary"
              defaultPrompt={defaultWorkSummaryPrompt}
              currentPrompt={store.workSummaryPrompt}
              onSavePrompt={store.setWorkSummaryPrompt}
              onResetPrompt={store.resetWorkSummaryPrompt}
              helpText="此提示词将用于评估小说商业逻辑，梳理人物、线索和分章节剧情，并提供多维度详细打分建议。"
            />
          </section>

          <Divider style={{ borderColor: '#eae6df', margin: '48px 0' }} />

          {/* 大纲页设置区域 */}
          <section id="outline-config" style={{ marginBottom: 48 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '24px' }}>
              <AlertOutlined style={{ fontSize: '20px', color: '#d97757' }} />
              <Title level={4} style={{ color: '#33312e', margin: 0, fontWeight: 600 }}>大纲页设置</Title>
            </div>

            <AgentSettingCard
              title="大纲制作 Agent"
              agentId="outlineCreation"
              defaultPrompt={defaultOutlineCreationPrompt}
              currentPrompt={store.outlineCreationPrompt}
              onSavePrompt={store.setOutlineCreationPrompt}
              onResetPrompt={store.resetOutlineCreationPrompt}
              helpText="此提示词将作为大纲制作 Agent 的核心规范，用于新建、改写或根据评估建议重构大纲。"
            />

            <AgentSettingCard
              title="大纲评估 Agent"
              agentId="outlineAssessment"
              defaultPrompt={defaultOutlineAssessmentPrompt}
              currentPrompt={store.outlineAssessmentPrompt}
              onSavePrompt={store.setOutlineAssessmentPrompt}
              onResetPrompt={store.resetOutlineAssessmentPrompt}
              helpText="此提示词将作为大纲评估的主力人设，评估引流能力、开局钩子、情绪脑洞并进行 5 维度商业估分。"
            />
          </section>

          <Divider style={{ borderColor: '#eae6df', margin: '48px 0' }} />

          {/* 去AI味页设置区域 */}
          <section id="deai-config" style={{ marginBottom: 48 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '24px' }}>
              <SafetyCertificateOutlined style={{ fontSize: '20px', color: '#d97757' }} />
              <Title level={4} style={{ color: '#33312e', margin: 0, fontWeight: 600 }}>去AI味页设置</Title>
            </div>

            <AgentSettingCard
              title="检测 AI 味 Agent"
              agentId="detector"
              defaultPrompt={defaultDeAiDetectorPrompt}
              currentPrompt={store.deAiDetectorPrompt}
              onSavePrompt={store.setDeAiDetectorPrompt}
              onResetPrompt={store.resetDeAiDetectorPrompt}
              helpText="此提示词将作为去AI味页面的核心评测准则，检测 8 项 AI Slop 特征并对文章进行打分。"
            />

            <AgentSettingCard
              title="去除 AI 味 Agent"
              agentId="remover"
              defaultPrompt={defaultDeAiRemoverPrompt}
              currentPrompt={store.deAiRemoverPrompt}
              onSavePrompt={store.setDeAiRemoverPrompt}
              onResetPrompt={store.resetDeAiRemoverPrompt}
              helpText="此提示词将作为润色去AI味的专家规范，依据分析意见小步快跑地优化文章，让人味更加突出。"
            />
          </section>

        </div>
      </div>
    </div>
  );
};

export default Settings;
