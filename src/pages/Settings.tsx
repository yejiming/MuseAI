import React from 'react';
import { Form, Input, Button, InputNumber, Divider, Typography, Select, message, Anchor } from 'antd';
import { invoke } from '@tauri-apps/api/core';
import {
  useSettingsStore,
  defaultSystemPrompt,
  defaultDeAiDetectorPrompt,
  defaultDeAiRemoverPrompt,
} from '../stores/useSettingsStore';


const { Title, Text } = Typography;
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

const Settings: React.FC = () => {
  const store = useSettingsStore();
  
  const [modelForm] = Form.useForm();
  const [promptForm] = Form.useForm();
  const [selectedAgentId, setSelectedAgentId] = React.useState<string>('global');

  const agentOptions = [
    { value: 'global', label: '全局默认配置' },
    { value: 'writer', label: '写文章Agent' },
    { value: 'detector', label: '检测AI味Agent' },
    { value: 'remover', label: '去除AI味Agent' },
  ];


  React.useEffect(() => {
    if (selectedAgentId === 'global') {
      modelForm.setFieldsValue(store);
    } else {
      const agentConfig = store.agentConfigs?.[selectedAgentId] || {};
      modelForm.setFieldsValue({
        ...store,
        temperature: agentConfig.temperature ?? store.temperature,
        maxOutputTokens: agentConfig.maxOutputTokens ?? store.maxOutputTokens,
        maxContextTokens: agentConfig.maxContextTokens ?? store.maxContextTokens,
        thinkingDepth: agentConfig.thinkingDepth ?? store.thinkingDepth,
      });
    }
    
    promptForm.setFieldsValue({
      systemPrompt: store.systemPrompt || defaultSystemPrompt,
      deAiDetectorPrompt: store.deAiDetectorPrompt || defaultDeAiDetectorPrompt,
      deAiRemoverPrompt: store.deAiRemoverPrompt || defaultDeAiRemoverPrompt,
    });
  }, [store, modelForm, promptForm, selectedAgentId]);

  const handleSaveModelConfig = (values: any) => {
    if (selectedAgentId === 'global') {
      store.setLlmConfig(values);
    } else {
      store.setLlmConfig({
        llmProvider: values.llmProvider,
        modelInterface: values.modelInterface,
        llmModel: values.llmModel,
        llmBaseUrl: values.llmBaseUrl,
        llmApiKey: values.llmApiKey,
      });
      store.setAgentConfig(selectedAgentId, {
        temperature: values.temperature,
        maxOutputTokens: values.maxOutputTokens,
        maxContextTokens: values.maxContextTokens,
        thinkingDepth: values.thinkingDepth,
      });
    }
    message.success('已保存模型配置');
  };

  const promptActions = {
    systemPrompt: {
      save: () => store.setSystemPrompt(promptForm.getFieldValue('systemPrompt')),
      reset: () => {
        promptForm.setFieldsValue({ systemPrompt: defaultSystemPrompt });
        store.resetSystemPrompt();
      },
    },
    deAiDetectorPrompt: {
      save: () => store.setDeAiDetectorPrompt(promptForm.getFieldValue('deAiDetectorPrompt')),
      reset: () => {
        promptForm.setFieldsValue({ deAiDetectorPrompt: defaultDeAiDetectorPrompt });
        store.resetDeAiDetectorPrompt();
      },
    },
    deAiRemoverPrompt: {
      save: () => store.setDeAiRemoverPrompt(promptForm.getFieldValue('deAiRemoverPrompt')),
      reset: () => {
        promptForm.setFieldsValue({ deAiRemoverPrompt: defaultDeAiRemoverPrompt });
        store.resetDeAiRemoverPrompt();
      },
    },
  };

  const handleSavePrompt = (field: keyof typeof promptActions) => {
    promptActions[field].save();
    message.success('已保存提示词');
  };

  const handleResetPrompt = (field: keyof typeof promptActions) => {
    promptActions[field].reset();
    message.success('已恢复默认提示词');
  };



  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden', background: '#faf9f5' }}>
      <div style={{ width: 180, padding: '40px 0 40px 24px', borderRight: '1px solid #eae6df', overflowY: 'auto', flexShrink: 0 }}>
        <Anchor
          affix={false}
          getContainer={() => document.getElementById('settings-scroll-container') as HTMLElement}
          onClick={(e) => e.preventDefault()}
          items={[
            { key: 'model-config', href: '#model-config', title: '模型配置' },
            { key: 'system-prompt', href: '#system-prompt', title: '系统提示词' },
          ]}
        />
      </div>
      <div id="settings-scroll-container" style={{ flex: 1, padding: '40px 24px', overflowY: 'auto', paddingBottom: 100 }}>
        <div style={{ maxWidth: 800, margin: '0 auto' }}>
          
          {/* 标题 */}
          <Title level={2} style={{ fontWeight: 600, color: '#33312e', marginBottom: 40 }}>
            设置
          </Title>

          {/* 模型配置区域 */}
          <section id="model-config" style={{ marginBottom: 60 }}>
          <Title level={4} style={{ color: '#d97757', marginBottom: 24 }}>模型配置</Title>
          <Form
            form={modelForm}
            layout="vertical"
            initialValues={store}
            onFinish={handleSaveModelConfig}
            requiredMark={false}
          >
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 24px' }}>
              <Form.Item label="模型服务商 (Provider)" name="llmProvider">
                <Select
                  onChange={(value) => {
                    const preset = MODEL_PROVIDER_PRESETS.find((p) => p.provider === value);
                    if (preset && preset.provider !== "Custom") {
                      modelForm.setFieldsValue({
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

            <Form.Item label="模型 API Key (API Key)" name="llmApiKey">
              <Input.Password placeholder="sk-..." />
            </Form.Item>

            <div style={{ 
              marginTop: 32, 
              paddingTop: 24, 
              borderTop: '1px dashed #eae6df',
              display: 'flex',
              flexDirection: 'column',
              gap: '16px' 
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
                <Text strong>针对指定Agent进行配置 (仅限以下四个参数)：</Text>
                <Select
                  value={selectedAgentId}
                  onChange={setSelectedAgentId}
                  options={agentOptions}
                  style={{ width: 160 }}
                />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '16px' }}>
              <Form.Item label="温度 (Temperature)" name="temperature" style={{ flex: 1, whiteSpace: 'nowrap' }}>
                <InputNumber min={0} max={2} step={0.1} style={{ width: '100%', maxWidth: 160 }} />
              </Form.Item>
              <Form.Item label="最大输出 Token" name="maxOutputTokens" style={{ flex: 1, whiteSpace: 'nowrap' }}>
                <InputNumber min={1} style={{ width: '100%', maxWidth: 160 }} />
              </Form.Item>
              <Form.Item label="最大上下文 Token" name="maxContextTokens" style={{ flex: 1, whiteSpace: 'nowrap' }}>
                <InputNumber min={1} step={1024} style={{ width: '100%', maxWidth: 160 }} />
              </Form.Item>
              <Form.Item label="思考深度 (Depth)" name="thinkingDepth" style={{ flex: 1, whiteSpace: 'nowrap' }}>
                <Select 
                  style={{ width: '100%', maxWidth: 160 }}
                  options={effortLevelOptions.map((opt) => ({ value: opt.id, label: opt.label }))}
                />
              </Form.Item>
            </div>
            </div>

            <Form.Item style={{ marginTop: 24 }}>
              <Button type="primary" htmlType="submit" size="large">
                保存模型配置
              </Button>
            </Form.Item>
          </Form>
        </section>

        <Divider style={{ borderColor: '#eae6df', margin: '40px 0' }} />

        {/* 系统提示词区域 */}
        <section id="system-prompt" style={{ marginBottom: 60 }}>
          <Title level={4} style={{ color: '#d97757', marginBottom: 24 }}>系统提示词 (System Prompt)</Title>
          <Form
            form={promptForm}
            layout="vertical"
            initialValues={{
              systemPrompt: store.systemPrompt || defaultSystemPrompt,
              deAiDetectorPrompt: store.deAiDetectorPrompt || defaultDeAiDetectorPrompt,
              deAiRemoverPrompt: store.deAiRemoverPrompt || defaultDeAiRemoverPrompt,
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 40 }}>
              <div>
                <Form.Item
                  label="写文章Agent"
                  name="systemPrompt"
                  help="此提示词将作为作品页写文章Agent初始化时的核心设定。"
                  style={{ marginBottom: 16 }}
                >
                  <TextArea 
                    rows={9} 
                    placeholder="请输入写文章Agent的系统提示词..."
                    style={{ resize: 'none', backgroundColor: '#faf9f5', border: '1px solid #eae6df' }} 
                  />
                </Form.Item>
                <div style={{ display: 'flex', gap: 12 }}>
                  <Button type="primary" size="large" onClick={() => handleSavePrompt('systemPrompt')}>
                    保存提示词
                  </Button>
                  <Button size="large" onClick={() => handleResetPrompt('systemPrompt')}>
                    恢复默认
                  </Button>
                </div>
              </div>

              <div>
                <Form.Item
                  label="检测AI味Agent"
                  name="deAiDetectorPrompt"
                  help="此提示词将作为去AI味页面检测AI味Agent的核心设定。"
                  style={{ marginBottom: 16 }}
                >
                  <TextArea 
                    rows={7} 
                    placeholder="请输入检测AI味Agent的系统提示词..."
                    style={{ resize: 'none', backgroundColor: '#faf9f5', border: '1px solid #eae6df' }} 
                  />
                </Form.Item>
                <div style={{ display: 'flex', gap: 12 }}>
                  <Button type="primary" size="large" onClick={() => handleSavePrompt('deAiDetectorPrompt')}>
                    保存提示词
                  </Button>
                  <Button size="large" onClick={() => handleResetPrompt('deAiDetectorPrompt')}>
                    恢复默认
                  </Button>
                </div>
              </div>

              <div>
                <Form.Item
                  label="去除AI味Agent"
                  name="deAiRemoverPrompt"
                  help="此提示词将作为去AI味页面去除AI味Agent的核心设定。"
                  style={{ marginBottom: 16 }}
                >
                  <TextArea 
                    rows={7} 
                    placeholder="请输入去除AI味Agent的系统提示词..."
                    style={{ resize: 'none', backgroundColor: '#faf9f5', border: '1px solid #eae6df' }} 
                  />
                </Form.Item>
                <div style={{ display: 'flex', gap: 12 }}>
                  <Button type="primary" size="large" onClick={() => handleSavePrompt('deAiRemoverPrompt')}>
                  保存提示词
                  </Button>
                  <Button size="large" onClick={() => handleResetPrompt('deAiRemoverPrompt')}>
                    恢复默认
                  </Button>
                </div>
              </div>
            </div>
          </Form>
        </section>



        </div>
      </div>
    </div>
  );
};

export default Settings;
