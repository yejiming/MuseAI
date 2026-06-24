import React from 'react';
import { Form, Input, Button, InputNumber, Divider, Typography, Select, message, Anchor, Card, Modal, Space, Popconfirm } from 'antd';
import {
  SettingOutlined,
  BookOutlined,
  DeploymentUnitOutlined,
  ClearOutlined,
  ProfileOutlined,
  GlobalOutlined,
  MessageOutlined,
  CompassOutlined,
  HeartOutlined,
  PlusOutlined,
  DeleteOutlined,
  CheckOutlined,
  CloseOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import { invoke } from '@tauri-apps/api/core';
import {
  useSettingsStore,
  defaultAgentConfigs,
  defaultSystemPrompt,
  defaultDeAiDetectorPrompt,
  defaultDeAiRemoverPrompt,
  defaultWorkSummaryPrompt,
  defaultOutlineCreationPrompt,
  defaultOutlineAssessmentPrompt,
  defaultReverseOutlineShortPrompt,
  defaultReverseOutlineLongSummaryPrompt,
  defaultReverseOutlineLongFinalPrompt,
  defaultPartnerChatPrompt,
  defaultBackgroundWorldBookPrompt,
  defaultBackgroundCharacterCardPrompt,
  defaultStoryAgentPrompt,
  defaultStoryDynamicAgentPrompt,
  defaultBookTravelMaterialAssemblerPrompt,
  defaultBookTravelEntryDirectorPrompt,
  defaultBookTravelPlotPlannerPrompt,
  defaultBookTravelSceneWriterPrompt,
  defaultBookTravelMemoryKeeperPrompt,
  defaultBookTravelEndingJudgePrompt,
  defaultChatArchivePrompt,
  defaultStoryArchivePrompt,
} from '../stores/useSettingsStore';
import { SettingsConcurrencyCard } from '../components/SettingsConcurrencyCard';

const { Title, Text } = Typography;
const { TextArea } = Input;

const SETTINGS_SIDEBAR_STYLE: React.CSSProperties = {
  width: 180,
  padding: '40px 0 40px 24px',
  borderRight: '1px solid #eae6df',
  overflowY: 'auto',
  flexShrink: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: '8px',
};

const SETTINGS_MODEL_SELECTOR_ROW_STYLE: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '12px',
  marginBottom: '24px',
  backgroundColor: '#faf9f5',
  padding: '16px',
  borderRadius: '8px',
  border: '1px solid #f2eee8',
};

const SETTINGS_TEST_RESULT_BASE_STYLE: React.CSSProperties = {
  marginBottom: '24px',
  padding: '12px 16px',
  borderRadius: '8px',
  display: 'flex',
  alignItems: 'flex-start',
  gap: '8px',
  fontSize: '14px',
};

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
  showModelControls?: boolean;
}

const AgentSettingCard: React.FC<AgentSettingCardProps> = ({
  title,
  agentId,
  defaultPrompt,
  currentPrompt,
  onSavePrompt,
  onResetPrompt,
  helpText,
  showModelControls = true,
}) => {
  const store = useSettingsStore();
  const [form] = Form.useForm();
  const defaultConfig = React.useMemo(() => defaultAgentConfigs[agentId] || {}, [agentId]);
  const agentConfig = store.agentConfigs?.[agentId] || defaultConfig;
  const supportsCompactionTurnThreshold = agentId === 'partnerChat' || agentId === 'storyAgent' || agentId === 'storyDynamicAgent';
  const supportsSamplingControls = supportsCompactionTurnThreshold;

  React.useEffect(() => {
    const values: Record<string, unknown> = {
      temperature: agentConfig.temperature ?? defaultConfig.temperature ?? 0.3,
      maxOutputTokens: agentConfig.maxOutputTokens ?? defaultConfig.maxOutputTokens ?? 32000,
      maxContextTokens: agentConfig.maxContextTokens ?? defaultConfig.maxContextTokens ?? 200000,
      thinkingDepth: agentConfig.thinkingDepth ?? defaultConfig.thinkingDepth ?? 'off',
      prompt: currentPrompt,
    };
    if (supportsCompactionTurnThreshold) {
      values.compactionTurnThreshold = agentConfig.compactionTurnThreshold ?? defaultConfig.compactionTurnThreshold ?? 20;
    }
    if (supportsSamplingControls) {
      values.frequencyPenalty = agentConfig.frequencyPenalty ?? defaultConfig.frequencyPenalty ?? 0.3;
      values.presencePenalty = agentConfig.presencePenalty ?? defaultConfig.presencePenalty ?? 0.2;
      values.topP = agentConfig.topP ?? defaultConfig.topP ?? 0.9;
    }
    form.setFieldsValue(values);
  }, [agentConfig, currentPrompt, defaultConfig, form, supportsCompactionTurnThreshold, supportsSamplingControls]);

  const handleSave = (values: any) => {
    if (showModelControls) {
      const nextConfig = {
        temperature: values.temperature,
        maxOutputTokens: values.maxOutputTokens,
        maxContextTokens: values.maxContextTokens,
        thinkingDepth: values.thinkingDepth,
        ...(supportsCompactionTurnThreshold ? { compactionTurnThreshold: values.compactionTurnThreshold ?? 20 } : {}),
        ...(supportsSamplingControls ? {
          frequencyPenalty: values.frequencyPenalty ?? 0.3,
          presencePenalty: values.presencePenalty ?? 0.2,
          topP: values.topP ?? 0.9,
        } : {}),
      };
      store.setAgentConfig(agentId, nextConfig);
    }
    onSavePrompt(values.prompt);
    message.success(`已保存 ${title} 配置`);
  };

  const handleReset = () => {
    const values: Record<string, unknown> = {
      temperature: defaultConfig.temperature ?? 0.3,
      maxOutputTokens: defaultConfig.maxOutputTokens ?? 32000,
      maxContextTokens: defaultConfig.maxContextTokens ?? 200000,
      thinkingDepth: defaultConfig.thinkingDepth ?? 'off',
      prompt: defaultPrompt,
    };
    if (supportsCompactionTurnThreshold) {
      values.compactionTurnThreshold = defaultConfig.compactionTurnThreshold ?? 20;
    }
    if (supportsSamplingControls) {
      values.frequencyPenalty = defaultConfig.frequencyPenalty ?? 0.3;
      values.presencePenalty = defaultConfig.presencePenalty ?? 0.2;
      values.topP = defaultConfig.topP ?? 0.9;
    }
    form.setFieldsValue(values);
    if (showModelControls) {
      const nextConfig = {
        temperature: defaultConfig.temperature,
        maxOutputTokens: defaultConfig.maxOutputTokens,
        maxContextTokens: defaultConfig.maxContextTokens,
        thinkingDepth: defaultConfig.thinkingDepth,
        ...(supportsCompactionTurnThreshold ? { compactionTurnThreshold: defaultConfig.compactionTurnThreshold ?? 20 } : {}),
        ...(supportsSamplingControls ? {
          frequencyPenalty: defaultConfig.frequencyPenalty ?? 0.3,
          presencePenalty: defaultConfig.presencePenalty ?? 0.2,
          topP: defaultConfig.topP ?? 0.9,
        } : {}),
      };
      store.setAgentConfig(agentId, nextConfig);
    }
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
        {showModelControls && (
          <div style={{ marginBottom: '20px' }}>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
                gap: '16px',
                marginBottom: supportsCompactionTurnThreshold ? '16px' : 0
              }}
            >
              <Form.Item label="温度" name="temperature" style={{ marginBottom: 0 }}>
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
            {supportsCompactionTurnThreshold && (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
                  gap: '16px'
                }}
              >
              <Form.Item
                label="自动压缩轮数"
                name="compactionTurnThreshold"
                tooltip="MuseAI 内部上下文管理参数，OpenAI 接口和 Anthropic 接口都会使用。控制用户对话轮数超过多少后，后端自动压缩早期上下文；数值越大，保留原文越久，但 Token 成本更高。"
                style={{ marginBottom: 0 }}
              >
                <InputNumber min={2} max={200} step={1} style={{ width: '100%' }} />
              </Form.Item>
                <Form.Item
                  label="频率惩罚"
                  name="frequencyPenalty"
                  tooltip="对应 OpenAI 的 frequency_penalty，适用于 OpenAI-compatible 接口，用来降低重复词句的概率。Anthropic 接口不支持，MuseAI 不会向 Anthropic 请求发送此参数。"
                  style={{ marginBottom: 0 }}
                >
                  <InputNumber min={-2} max={2} step={0.1} style={{ width: '100%' }} />
                </Form.Item>
                <Form.Item
                  label="存在惩罚"
                  name="presencePenalty"
                  tooltip="对应 OpenAI 的 presence_penalty，适用于 OpenAI-compatible 接口，用来鼓励模型引入新内容、减少反复围绕旧话题。Anthropic 接口不支持，MuseAI 不会向 Anthropic 请求发送此参数。"
                  style={{ marginBottom: 0 }}
                >
                  <InputNumber min={-2} max={2} step={0.1} style={{ width: '100%' }} />
                </Form.Item>
                <Form.Item
                  label="Top P"
                  name="topP"
                  tooltip="对应 OpenAI 的 top_p，适用于 OpenAI-compatible 接口，用来控制候选词概率范围。Anthropic 部分模型曾支持，但新 Opus 模型不支持非默认采样参数；MuseAI 不会向 Anthropic 请求发送此参数。"
                  style={{ marginBottom: 0 }}
                >
                  <InputNumber min={0} max={1} step={0.05} style={{ width: '100%' }} />
                </Form.Item>
              </div>
            )}
          </div>
        )}

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

const useSettingsView = () => {
  const store = useSettingsStore();
  const [globalForm] = Form.useForm();
  const [addForm] = Form.useForm();

  const [isAddModalVisible, setIsAddModalVisible] = React.useState(false);
  const [isTesting, setIsTesting] = React.useState(false);
  const [testResult, setTestResult] = React.useState<{ success: boolean; msg: string } | null>(null);
  const [mobileStatus, setMobileStatus] = React.useState<{ isRunning: boolean; url: string | null; token: string | null; error: string | null } | null>(null);

  React.useEffect(() => {
    invoke('get_mobile_service_status')
      .then((status: any) => {
        setMobileStatus(status);
        // Auto-save token to localStorage when service starts
        if (status.token && typeof window !== 'undefined') {
          localStorage.setItem('mobile_token', status.token);
        }
      })
      .catch((e) => console.error('Failed to get mobile service status:', e));
  }, []);

  // Retrieve current active model configuration
  const currentModel = store.models?.find((m) => m.id === store.selectedModelId) || store.models?.[0];

  React.useEffect(() => {
    if (currentModel) {
      globalForm.setFieldsValue({
        name: currentModel.name,
        provider: currentModel.provider,
        modelInterface: currentModel.modelInterface,
        llmModel: currentModel.model,
        llmBaseUrl: currentModel.baseUrl,
        llmApiKey: currentModel.apiKey,
      });
      // Clear test result on model change
      setTestResult(null);
    }
  }, [store.selectedModelId, currentModel, globalForm]);

  const handleSaveGlobalConfig = (values: any) => {
    if (!store.selectedModelId) {
      message.error('请选择或添加一个模型配置');
      return;
    }
    store.updateModel(store.selectedModelId, {
      name: values.name,
      provider: values.provider,
      modelInterface: values.modelInterface,
      model: values.llmModel,
      baseUrl: values.llmBaseUrl,
      apiKey: values.llmApiKey,
    });
    message.success('已保存并应用模型设置');
  };

  const handleDeleteModel = () => {
    if (!store.selectedModelId) return;
    if ((store.models || []).length <= 1) {
      message.warning('必须保留至少一个模型配置');
      return;
    }
    store.deleteModel(store.selectedModelId);
    message.success('已删除当前模型配置');
  };

  const handleTestConnection = async () => {
    try {
      const values = await globalForm.validateFields();
      setIsTesting(true);
      setTestResult(null);

      const result = await invoke<string>('test_llm_connection', {
        request: {
          modelInterface: values.modelInterface,
          baseUrl: values.llmBaseUrl,
          apiKey: values.llmApiKey,
          model: values.llmModel,
        }
      });

      setIsTesting(false);
      setTestResult({ success: true, msg: result });
      message.success('连接测试成功！');
    } catch (err: any) {
      setIsTesting(false);
      const errMsg = typeof err === 'string' ? err : (err.message || JSON.stringify(err));
      setTestResult({ success: false, msg: errMsg });
      message.error('连接测试失败，请检查配置参数');
    }
  };

  const handleOpenAddModal = () => {
    addForm.resetFields();
    addForm.setFieldsValue({
      provider: 'DeepSeek',
      modelInterface: 'OpenAI-compatible',
      baseUrl: 'https://api.deepseek.com/v1',
    });
    setIsAddModalVisible(true);
  };

  const handleSaveNewModel = (values: any) => {
    store.addModel({
      name: values.name,
      provider: values.provider,
      modelInterface: values.modelInterface,
      baseUrl: values.baseUrl,
      apiKey: values.apiKey,
      model: values.model,
    });
    setIsAddModalVisible(false);
    message.success(`已添加并切换至模型：${values.name}`);
  };

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden', background: '#faf9f5' }}>
      {/* 左侧侧边菜单栏 */}
      <div style={SETTINGS_SIDEBAR_STYLE}>
        <Anchor
          affix={false}
          getContainer={() => document.getElementById('settings-scroll-container') as HTMLElement}
          onClick={(e) => e.preventDefault()}
          items={[
            { key: 'model-config', href: '#model-config', title: '模型设置' },
            { key: 'lan-config', href: '#lan-config', title: '局域网访问' },
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
        <Divider style={{ margin: '12px 16px 12px -8px', borderColor: '#eae6df', minWidth: 'auto', width: 'calc(100% - 8px)' }} />
        <Anchor
          affix={false}
          getContainer={() => document.getElementById('settings-scroll-container') as HTMLElement}
          onClick={(e) => e.preventDefault()}
          items={[
            { key: 'background-config', href: '#background-config', title: '背景页设置' },
            { key: 'partner-chat-config', href: '#partner-chat-config', title: '聊天页设置' },
            { key: 'story-agent-config', href: '#story-agent-config', title: '冒险页设置' },
            { key: 'bond-config', href: '#bond-config', title: '羁绊页设置' },
          ]}
        />
        <Divider style={{ margin: '12px 16px 12px -8px', borderColor: '#eae6df', minWidth: 'auto', width: 'calc(100% - 8px)' }} />
        <Anchor
          affix={false}
          getContainer={() => document.getElementById('settings-scroll-container') as HTMLElement}
          onClick={(e) => e.preventDefault()}
          items={[
            { key: 'book-travel-material-config', href: '#book-travel-material-config', title: '素材页设置' },
            { key: 'book-travel-config', href: '#book-travel-config', title: '穿书页设置' },
          ]}
        />
      </div>

      {/* 右侧核心内容区域 */}
      <div id="settings-scroll-container" style={{ flex: 1, padding: '40px 48px', overflowY: 'auto', paddingBottom: 120 }}>
        <div style={{ maxWidth: 800, margin: '0 auto' }}>

          <Title level={2} style={{ fontWeight: 600, color: '#33312e', marginBottom: 40, letterSpacing: '-0.5px', fontFamily: '"Inter", "Roboto", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}>
            设置
          </Title>

          {/* 全局模型配置区域 */}
          <section id="model-config" style={{ marginBottom: 48 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '24px' }}>
              <SettingOutlined style={{ fontSize: '20px', color: '#d97757' }} />
              <Title level={4} style={{ color: '#33312e', margin: 0, fontWeight: 600, fontFamily: '"Inter", "Roboto", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}>全局模型设置</Title>
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
              {/* 模型选择区域 */}
              <div style={SETTINGS_MODEL_SELECTOR_ROW_STYLE}>
                <span style={{ fontWeight: 500, color: '#5c5751', flexShrink: 0 }}>当前使用模型:</span>
                <Select
                  value={store.selectedModelId}
                  onChange={(val) => store.selectModel(val)}
                  style={{ flex: 1, minWidth: 200 }}
                  options={(store.models || []).map((m) => ({ label: m.name, value: m.id }))}
                />
                <Button
                  type="primary"
                  icon={<PlusOutlined />}
                  onClick={handleOpenAddModal}
                  style={{
                    backgroundColor: '#d97757',
                    borderColor: '#d97757',
                    color: '#ffffff',
                    fontWeight: 500,
                    borderRadius: '6px'
                  }}
                >
                  添加模型
                </Button>
              </div>

              <Form
                form={globalForm}
                layout="vertical"
                onFinish={handleSaveGlobalConfig}
                requiredMark={false}
              >
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 24px' }}>
                  <Form.Item label="配置显示名称" name="name" rules={[{ required: true, message: '显示名称不能为空' }]}>
                    <Input placeholder="例如: GPT-4o 写作模型" />
                  </Form.Item>
                  <Form.Item label="模型服务商 (Provider)" name="provider">
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
                  <Form.Item label="模型名称 (Model)" name="llmModel" rules={[{ required: true, message: '模型名称不能为空' }]}>
                    <Input placeholder="例如: gpt-4o, claude-3-5-sonnet" />
                  </Form.Item>

                  <Form.Item label="接口地址 (Base URL)" name="llmBaseUrl" rules={[{ required: true, message: '接口地址不能为空' }]}>
                    <Input placeholder="https://api.openai.com/v1" />
                  </Form.Item>
                  <Form.Item label="模型 API Key (API Key)" name="llmApiKey" rules={[{ required: true, message: 'API Key 不能为空' }]}>
                    <Input.Password placeholder="sk-..." />
                  </Form.Item>
                </div>

                {/* 连接测试结果回显 */}
                {testResult && (
                  <div
                    style={{
                      ...SETTINGS_TEST_RESULT_BASE_STYLE,
                      border: testResult.success ? '1px solid #d4edda' : '1px solid #f8d7da',
                      backgroundColor: testResult.success ? '#d4edda20' : '#f8d7da20',
                      color: testResult.success ? '#155724' : '#721c24',
                    }}
                  >
                    {testResult.success ? (
                      <CheckOutlined style={{ color: '#28a745', marginTop: '3px' }} />
                    ) : (
                      <CloseOutlined style={{ color: '#dc3545', marginTop: '3px' }} />
                    )}
                    <div style={{ wordBreak: 'break-all' }}>
                      <strong style={{ display: 'block', marginBottom: '4px' }}>
                        {testResult.success ? '连接测试成功' : '连接测试失败'}
                      </strong>
                      {testResult.msg}
                    </div>
                  </div>
                )}

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 }}>
                  <Space size={12}>
                    <Button
                      type="primary"
                      htmlType="submit"
                      style={{
                        backgroundColor: '#d97757',
                        borderColor: '#d97757',
                        color: '#ffffff',
                        fontWeight: 500,
                        borderRadius: '6px',
                        padding: '0 24px'
                      }}
                    >
                      保存并应用
                    </Button>
                    <Button
                      icon={<ThunderboltOutlined />}
                      onClick={handleTestConnection}
                      loading={isTesting}
                      style={{
                        borderColor: '#eae6df',
                        color: '#5c5751',
                        borderRadius: '6px',
                        padding: '0 16px'
                      }}
                    >
                      测试连接
                    </Button>
                  </Space>

                  <Popconfirm
                    title="确定要删除当前模型配置吗？"
                    onConfirm={handleDeleteModel}
                    okText="确定"
                    cancelText="取消"
                    disabled={(store.models || []).length <= 1}
                  >
                    <Button
                      danger
                      icon={<DeleteOutlined />}
                      disabled={(store.models || []).length <= 1}
                      style={{
                        borderRadius: '6px'
                      }}
                    >
                      删除模型
                    </Button>
                  </Popconfirm>
                </div>
              </Form>
            </Card>
          </section>

          {/* 局域网访问 */}
          <section id="lan-config" style={{ marginBottom: 48 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '24px' }}>
              <GlobalOutlined style={{ fontSize: '20px', color: '#d97757' }} />
              <Title level={4} style={{ color: '#33312e', margin: 0, fontWeight: 600, fontFamily: '"Inter", "Roboto", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}>局域网访问</Title>
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
              {mobileStatus ? (
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}>
                  <div
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: '50%',
                      backgroundColor: mobileStatus.isRunning ? '#52c41a' : '#f5222d',
                      marginTop: 6,
                      flexShrink: 0,
                    }}
                  />
                  <div style={{ flex: 1 }}>
                    <Text style={{ fontWeight: 600, color: '#33312e', fontSize: 14, display: 'block' }}>
                      {mobileStatus.isRunning ? '服务已启动' : '服务未运行'}
                    </Text>
                    {mobileStatus.isRunning && mobileStatus.url && (
                      <div style={{ marginTop: 6 }}>
                        <Text style={{ fontSize: 13, color: '#8c857b', display: 'block', lineHeight: 1.5 }}>
                          在同一个无线网络（WiFi）下，使用手机浏览器访问以下网址：
                        </Text>
                        <div style={{ marginTop: 8 }}>
                          <Text copyable style={{ fontSize: 14, color: '#d97757', fontWeight: 600 }}>
                            {mobileStatus.url}
                          </Text>
                        </div>
                        {mobileStatus.token && (
                          <div style={{ marginTop: 12, padding: 10, backgroundColor: '#f5f3f0', borderRadius: 4 }}>
                            <Text style={{ fontSize: 12, color: '#8c857b', display: 'block', lineHeight: 1.5, marginBottom: 4 }}>
                              首次访问时，请在手机浏览器的控制台（开发者工具）中执行以下命令保存访问令牌：
                            </Text>
                            <Text copyable code style={{ fontSize: 11, display: 'block', marginTop: 4 }}>
                              localStorage.setItem('mobile_token', '{mobileStatus.token}')
                            </Text>
                            <Text style={{ fontSize: 11, color: '#8c857b', display: 'block', marginTop: 6, lineHeight: 1.4 }}>
                              或者复制令牌：<Text copyable code style={{ fontSize: 11 }}>{mobileStatus.token}</Text>
                            </Text>
                          </div>
                        )}
                      </div>
                    )}
                    {mobileStatus.error && (
                      <div style={{ marginTop: 6, color: '#f5222d', fontSize: 12 }}>
                        服务启动出错：{mobileStatus.error}
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div style={{ color: '#8c857b', fontSize: 14 }}>
                  正在获取局域网服务状态...
                </div>
              )}
            </Card>
          </section>

          {/* 添加模型弹窗 */}
          <Modal
            title={<div style={{ fontWeight: 600, color: '#33312e' }}>添加新模型配置</div>}
            open={isAddModalVisible}
            onCancel={() => setIsAddModalVisible(false)}
            onOk={() => addForm.submit()}
            okText="添加"
            cancelText="取消"
            styles={{ body: { paddingTop: '16px' } }}
            okButtonProps={{
              style: {
                backgroundColor: '#d97757',
                borderColor: '#d97757',
                borderRadius: '6px'
              }
            }}
            cancelButtonProps={{
              style: {
                borderRadius: '6px'
              }
            }}
          >
            <Form
              form={addForm}
              layout="vertical"
              onFinish={handleSaveNewModel}
              requiredMark={false}
            >
              <Form.Item label="配置显示名称" name="name" rules={[{ required: true, message: '请输入配置显示名称' }]}>
                <Input placeholder="例如: GPT-4o 写作模型" />
              </Form.Item>
              <Form.Item label="模型服务商 (Provider)" name="provider">
                <Select
                  onChange={(value) => {
                    const preset = MODEL_PROVIDER_PRESETS.find((p) => p.provider === value);
                    if (preset && preset.provider !== "Custom") {
                      addForm.setFieldsValue({
                        baseUrl: preset.baseUrl,
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
              <Form.Item label="模型名称 (Model)" name="model" rules={[{ required: true, message: '请输入模型名称' }]}>
                <Input placeholder="例如: gpt-4o, claude-3-5-sonnet" />
              </Form.Item>
              <Form.Item label="接口地址 (Base URL)" name="baseUrl" rules={[{ required: true, message: '请输入接口地址' }]}>
                <Input placeholder="https://api.openai.com/v1" />
              </Form.Item>
              <Form.Item label="模型 API Key (API Key)" name="apiKey" rules={[{ required: true, message: '请输入 API Key' }]}>
                <Input.Password placeholder="sk-..." />
              </Form.Item>
            </Form>
          </Modal>

          <Divider style={{ borderColor: '#eae6df', margin: '48px 0' }} />

          {/* 作品页设置区域 */}
          <section id="works-config" style={{ marginBottom: 48 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '24px' }}>
              <BookOutlined style={{ fontSize: '20px', color: '#d97757' }} />
              <Title level={4} style={{ color: '#33312e', margin: 0, fontWeight: 600, fontFamily: '"Inter", "Roboto", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}>作品页设置</Title>
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
              <ProfileOutlined style={{ fontSize: '20px', color: '#d97757' }} />
              <Title level={4} style={{ color: '#33312e', margin: 0, fontWeight: 600, fontFamily: '"Inter", "Roboto", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}>大纲页设置</Title>
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

            <AgentSettingCard
              title="AI反向分析大纲：短篇"
              agentId="reverseOutlineShort"
              defaultPrompt={defaultReverseOutlineShortPrompt}
              currentPrompt={store.reverseOutlineShortPrompt}
              onSavePrompt={store.setReverseOutlineShortPrompt}
              onResetPrompt={store.resetReverseOutlineShortPrompt}
              helpText="此配置用于短篇反向分析，直接读取完整文本并生成结构化大纲。"
            />

            <AgentSettingCard
              title="AI反向分析大纲：长篇-分段摘要"
              agentId="reverseOutlineLongSummary"
              defaultPrompt={defaultReverseOutlineLongSummaryPrompt}
              currentPrompt={store.reverseOutlineLongSummaryPrompt}
              onSavePrompt={store.setReverseOutlineLongSummaryPrompt}
              onResetPrompt={store.resetReverseOutlineLongSummaryPrompt}
              helpText="此配置用于长篇反向分析的第一阶段，将每 10 段内容压缩成剧情概要。"
            />

            <AgentSettingCard
              title="AI反向分析大纲：长篇-汇总大纲"
              agentId="reverseOutlineLongFinal"
              defaultPrompt={defaultReverseOutlineLongFinalPrompt}
              currentPrompt={store.reverseOutlineLongFinalPrompt}
              onSavePrompt={store.setReverseOutlineLongFinalPrompt}
              onResetPrompt={store.resetReverseOutlineLongFinalPrompt}
              helpText="此配置用于长篇反向分析的第二阶段，根据分段概要汇总生成最终大纲。"
            />

            <SettingsConcurrencyCard
              agentId="reverseOutline"
              label="AI 反向分析大纲并发数"
              helpText="仅用于长篇文章的分布式并行分析，默认 5，建议不要超过 20。"
              saveMessage="已保存 AI 反向分析大纲并发数"
            />
          </section>

          <Divider style={{ borderColor: '#eae6df', margin: '48px 0' }} />

          {/* 去AI味页设置区域 */}
          <section id="deai-config" style={{ marginBottom: 48 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '24px' }}>
              <ClearOutlined style={{ fontSize: '20px', color: '#d97757' }} />
              <Title level={4} style={{ color: '#33312e', margin: 0, fontWeight: 600, fontFamily: '"Inter", "Roboto", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}>去AI味页设置</Title>
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

          <Divider style={{ borderColor: '#eae6df', margin: '48px 0' }} />

          {/* 背景页设置区域 */}
          <section id="background-config" style={{ marginBottom: 48 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '24px' }}>
              <GlobalOutlined style={{ fontSize: '20px', color: '#d97757' }} />
              <Title level={4} style={{ color: '#33312e', margin: 0, fontWeight: 600, fontFamily: '"Inter", "Roboto", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}>背景页设置</Title>
            </div>

            <SettingsConcurrencyCard
              agentId="backgroundExtraction"
              label="AI 提取背景设定并发数"
              helpText="仅用于并行提取角色卡，默认 5，建议不要超过 20。"
              saveMessage="已保存 AI 提取背景设定并发数"
            />

            <AgentSettingCard
              title="提取世界书"
              agentId="backgroundWorldBook"
              defaultPrompt={defaultBackgroundWorldBookPrompt}
              currentPrompt={store.backgroundWorldBookPrompt}
              onSavePrompt={store.setBackgroundWorldBookPrompt}
              onResetPrompt={store.resetBackgroundWorldBookPrompt}
              helpText="此提示词用于 AI 智能提取背景设定的第一阶段：生成世界书，并在完整模式下提取角色名列表。"
            />

            <AgentSettingCard
              title="提取角色卡"
              agentId="backgroundCharacterCard"
              defaultPrompt={defaultBackgroundCharacterCardPrompt}
              currentPrompt={store.backgroundCharacterCardPrompt}
              onSavePrompt={store.setBackgroundCharacterCardPrompt}
              onResetPrompt={store.resetBackgroundCharacterCardPrompt}
              helpText="此提示词用于 AI 智能提取背景设定的第二阶段：按角色名分别生成结构化角色卡。"
            />
          </section>

          <Divider style={{ borderColor: '#eae6df', margin: '48px 0' }} />

          {/* 聊天页设置区域 */}
          <section id="partner-chat-config" style={{ marginBottom: 48 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '24px' }}>
              <MessageOutlined style={{ fontSize: '20px', color: '#d97757' }} />
              <Title level={4} style={{ color: '#33312e', margin: 0, fontWeight: 600, fontFamily: '"Inter", "Roboto", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}>聊天页设置</Title>
            </div>

            <AgentSettingCard
              title="伴侣对谈师"
              agentId="partnerChat"
              defaultPrompt={defaultPartnerChatPrompt}
              currentPrompt={store.partnerChatPrompt}
              onSavePrompt={store.setPartnerChatPrompt}
              onResetPrompt={store.resetPartnerChatPrompt}
              helpText="此提示词将作为伴侣聊天室中聊天 Agent 的核心系统提示词。结尾将自动且优雅地嵌入用户选择的世界书、角色卡和个人信息。"
            />
          </section>

          <Divider style={{ borderColor: '#eae6df', margin: '48px 0' }} />

          {/* 故事页设置区域 */}
          <section id="story-agent-config" style={{ marginBottom: 48 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '24px' }}>
              <CompassOutlined style={{ fontSize: '20px', color: '#d97757' }} />
              <Title level={4} style={{ color: '#33312e', margin: 0, fontWeight: 600, fontFamily: '"Inter", "Roboto", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}>冒险页设置</Title>
            </div>

            <AgentSettingCard
              title="冒险主持人（非动态加载）"
              agentId="storyAgent"
              defaultPrompt={defaultStoryAgentPrompt}
              currentPrompt={store.storyAgentPrompt}
              onSavePrompt={store.setStoryAgentPrompt}
              onResetPrompt={store.resetStoryAgentPrompt}
              helpText="此提示词将作为跑团/文字冒险故事中故事 Agent（主持GM）的核心系统提示词。结尾将自动且优雅地嵌入用户选择的世界书、多个角色卡和个人信息。第一条用户消息为填入的初始剧情。"
            />

            <AgentSettingCard
              title="冒险主持人（角色卡动态加载）"
              agentId="storyDynamicAgent"
              defaultPrompt={defaultStoryDynamicAgentPrompt}
              currentPrompt={store.storyDynamicAgentPrompt}
              onSavePrompt={store.setStoryDynamicAgentPrompt}
              onResetPrompt={store.resetStoryDynamicAgentPrompt}
              helpText="开启角色卡动态加载时使用此配置。此提示词会强调角色本人发言必须通过 role_play 生成。"
            />
          </section>

          <Divider style={{ borderColor: '#eae6df', margin: '48px 0' }} />

          {/* 羁绊页设置区域 */}
          <section id="bond-config" style={{ marginBottom: 48 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '24px' }}>
              <HeartOutlined style={{ fontSize: '20px', color: '#d97757' }} />
              <Title level={4} style={{ color: '#33312e', margin: 0, fontWeight: 600, fontFamily: '"Inter", "Roboto", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}>羁绊页设置</Title>
            </div>

            <AgentSettingCard
              title="聊天页-记忆封存师"
              agentId="chatArchive"
              defaultPrompt={defaultChatArchivePrompt}
              currentPrompt={store.chatArchivePrompt}
              onSavePrompt={store.setChatArchivePrompt}
              onResetPrompt={store.resetChatArchivePrompt}
              helpText="此提示词用于聊天页点击「封存记忆」时，AI 分析整场对话并提炼关系设定变化、关键事件与建议会话标题。"
            />

            <AgentSettingCard
              title="冒险页-记忆封存师"
              agentId="storyArchive"
              defaultPrompt={defaultStoryArchivePrompt}
              currentPrompt={store.storyArchivePrompt}
              onSavePrompt={store.setStoryArchivePrompt}
              onResetPrompt={store.resetStoryArchivePrompt}
              helpText="此提示词用于冒险页点击「封存记忆」时，AI 分析整场冒险并提炼关系设定变化、关键事件与建议会话标题。"
            />
          </section>

          <Divider style={{ borderColor: '#eae6df', margin: '48px 0' }} />

          {/* 素材页设置区域 */}
          <section id="book-travel-material-config" style={{ marginBottom: 48 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '24px' }}>
              <BookOutlined style={{ fontSize: '20px', color: '#d97757' }} />
              <Title level={4} style={{ color: '#33312e', margin: 0, fontWeight: 600, fontFamily: '"Inter", "Roboto", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}>素材页设置</Title>
            </div>

            <AgentSettingCard
              title="穿书素材装配师"
              agentId="bookTravelMaterialAssembler"
              defaultPrompt={defaultBookTravelMaterialAssemblerPrompt}
              currentPrompt={store.bookTravelMaterialAssemblerPrompt}
              onSavePrompt={store.setBookTravelMaterialAssemblerPrompt}
              onResetPrompt={store.resetBookTravelMaterialAssemblerPrompt}
              helpText="此提示词用于把已选大纲、世界书和角色卡整理成穿书运行所需的结构化世界模型。"
            />

            <AgentSettingCard
              title="穿书入场导演"
              agentId="bookTravelEntryDirector"
              defaultPrompt={defaultBookTravelEntryDirectorPrompt}
              currentPrompt={store.bookTravelEntryDirectorPrompt}
              onSavePrompt={store.setBookTravelEntryDirectorPrompt}
              onResetPrompt={store.resetBookTravelEntryDirectorPrompt}
              helpText="此提示词用于生成穿书入口和用户可选身份，帮助用户进入所选小说世界。"
            />
          </section>

          <Divider style={{ borderColor: '#eae6df', margin: '48px 0' }} />

          {/* 穿书页设置区域 */}
          <section id="book-travel-config" style={{ marginBottom: 48 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '24px' }}>
              <DeploymentUnitOutlined style={{ fontSize: '20px', color: '#d97757' }} />
              <Title level={4} style={{ color: '#33312e', margin: 0, fontWeight: 600, fontFamily: '"Inter", "Roboto", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}>穿书页设置</Title>
            </div>

            <AgentSettingCard
              title="穿书剧情规划师"
              agentId="bookTravelPlotPlanner"
              defaultPrompt={defaultBookTravelPlotPlannerPrompt}
              currentPrompt={store.bookTravelPlotPlannerPrompt}
              onSavePrompt={store.setBookTravelPlotPlannerPrompt}
              onResetPrompt={store.resetBookTravelPlotPlannerPrompt}
              helpText="此提示词用于分类用户输入、规划换场状态变化，并保持剧情因果。"
            />

            <AgentSettingCard
              title="穿书场景写手"
              agentId="bookTravelSceneWriter"
              defaultPrompt={defaultBookTravelSceneWriterPrompt}
              currentPrompt={store.bookTravelSceneWriterPrompt}
              onSavePrompt={store.setBookTravelSceneWriterPrompt}
              onResetPrompt={store.resetBookTravelSceneWriterPrompt}
              helpText="此提示词用于生成当前场景、节拍、选项和沉浸式中文叙事。"
            />

            <AgentSettingCard
              title="穿书记忆整理员"
              agentId="bookTravelMemoryKeeper"
              defaultPrompt={defaultBookTravelMemoryKeeperPrompt}
              currentPrompt={store.bookTravelMemoryKeeperPrompt}
              onSavePrompt={store.setBookTravelMemoryKeeperPrompt}
              onResetPrompt={store.resetBookTravelMemoryKeeperPrompt}
              helpText="此提示词用于压缩长线穿书历史，保留关键选择、关系变化和未解决伏笔。"
            />

            <AgentSettingCard
              title="穿书结局裁判"
              agentId="bookTravelEndingJudge"
              defaultPrompt={defaultBookTravelEndingJudgePrompt}
              currentPrompt={store.bookTravelEndingJudgePrompt}
              onSavePrompt={store.setBookTravelEndingJudgePrompt}
              onResetPrompt={store.resetBookTravelEndingJudgePrompt}
              helpText="此提示词用于判断结局条件，并生成最终结局、世界线名称和偏离度总结。"
            />
          </section>

          <Divider style={{ borderColor: '#eae6df', margin: '48px 0' }} />

        </div>
      </div>
    </div>
  );
};

const Settings: React.FC = () => useSettingsView();

export default Settings;
