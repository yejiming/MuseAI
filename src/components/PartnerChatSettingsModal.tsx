import React from 'react';
import { Modal, Form, Select, Input, Collapse, Button, message } from 'antd';
import { usePartnerStore } from '../stores/usePartnerStore';
import { usePartnerChatStore } from '../stores/usePartnerChatStore';
import { BookOutlined, UserOutlined, SettingOutlined } from '@ant-design/icons';

const { Panel } = Collapse;
const { TextArea } = Input;

interface PartnerChatSettingsModalProps {
  open: boolean;
  onCancel: () => void;
}

export const PartnerChatSettingsModal: React.FC<PartnerChatSettingsModalProps> = ({ open, onCancel }) => {
  const [form] = Form.useForm();
  
  const { worldBooks, characterCards } = usePartnerStore();
  const {
    selectedWorldBookId,
    selectedCharacterCardId,
    userInfo,
    setSelectedWorldBookId,
    setSelectedCharacterCardId,
    setUserInfo
  } = usePartnerChatStore();

  const syncFormValues = () => {
    const validWorldBookId = worldBooks.some(wb => wb.id === selectedWorldBookId) ? selectedWorldBookId : null;
    const validCharacterCardId = characterCards.some(cc => cc.id === selectedCharacterCardId) ? selectedCharacterCardId : null;

    if (validWorldBookId !== selectedWorldBookId) setSelectedWorldBookId(validWorldBookId);
    if (validCharacterCardId !== selectedCharacterCardId) setSelectedCharacterCardId(validCharacterCardId);

    form.setFieldsValue({
      worldBookId: validWorldBookId,
      characterCardId: validCharacterCardId,
      ...userInfo
    });
  };

  const handleSave = () => {
    const values = form.getFieldsValue();
    const { worldBookId, characterCardId, ...profileFields } = values;

    setSelectedWorldBookId(worldBookId || null);
    setSelectedCharacterCardId(characterCardId || null);
    setUserInfo(profileFields);

    message.success('已保存伴侣聊天配置');
    onCancel();
  };

  const handleClearProfile = () => {
    const clearedFields = {
      name: '',
      age: '',
      gender: '',
      race: '',
      birthplace: '',
      occupation: '',
      socialClass: '',
      heightBuild: '',
      iconicFeatures: '',
      clothingStyle: '',
      overallVibe: '',
      externalPersonality: '',
      internalPersonality: '',
      coreDesire: '',
      fearWeakness: '',
      moralValues: '',
      quirk: '',
      skills: '',
      backgroundStory: '',
      relationships: '',
      speakingStyle: '',
      typicalReactions: ''
    };

    form.setFieldsValue(clearedFields);
    message.info('已重置个人设定字段');
  };

  return (
    <Modal
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#33312e', fontSize: '18px', fontWeight: 600 }}>
          <SettingOutlined style={{ color: '#d97757' }} />
          <span>伴侣聊天配置</span>
        </div>
      }
      open={open}
      width={680}
      afterOpenChange={(visible) => {
        if (visible) syncFormValues();
      }}
      onCancel={onCancel}
      onOk={handleSave}
      okText="确认保存"
      cancelText="取消"
      styles={{
        body: { padding: '12px 0' }
      }}
    >
      <Form
        form={form}
        layout="vertical"
        requiredMark={false}
      >
        <div style={{ padding: '0 24px', marginBottom: '20px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
          <Form.Item
            label={
              <span style={{ fontWeight: 500, color: '#33312e' }}>
                <BookOutlined style={{ marginRight: 6, color: '#d97757' }} />世界书 (背景设定)
              </span>
            }
            name="worldBookId"
            help="选择对话所属的背景世界书，用以约束世界观架构"
          >
            <Select
              allowClear
              placeholder="点击选择世界书（可选）"
              options={worldBooks.map(item => ({ label: item.name, value: item.id }))}
              style={{ width: '100%' }}
            />
          </Form.Item>

          <Form.Item
            label={
              <span style={{ fontWeight: 500, color: '#33312e' }}>
                <UserOutlined style={{ marginRight: 6, color: '#d97757' }} />角色卡 (伴侣设定)
              </span>
            }
            name="characterCardId"
            help="选择聊天的伴侣角色卡，用以约束AI性格与说话方式"
          >
            <Select
              allowClear
              placeholder="点击选择角色卡（可选）"
              options={characterCards.map(item => ({ label: item.name, value: item.id }))}
              style={{ width: '100%' }}
            />
          </Form.Item>
        </div>

        <div style={{ padding: '0 24px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <span style={{ fontWeight: 600, color: '#33312e', fontSize: '14px' }}>我（用户）的个人设定</span>
            <Button size="small" onClick={handleClearProfile} style={{ fontSize: '12px', color: '#8c8882', borderColor: '#eae6df' }}>
              清空个人设定
            </Button>
          </div>

          <Collapse defaultActiveKey={['base']} expandIconPosition="end" style={{ background: '#faf9f5', border: '1px solid #eae6df', borderRadius: '8px' }}>
            <Panel header="1. 基础信息设定" key="base">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
                <Form.Item label="姓名" name="name">
                  <Input placeholder="例如: 陆明" />
                </Form.Item>
                <Form.Item label="年龄" name="age">
                  <Input placeholder="例如: 18岁" />
                </Form.Item>
                <Form.Item label="性别" name="gender">
                  <Input placeholder="例如: 男" />
                </Form.Item>
                <Form.Item label="种族" name="race">
                  <Input placeholder="例如: 人类" />
                </Form.Item>
                <Form.Item label="出生地" name="birthplace">
                  <Input placeholder="例如: 奥兰王国边境" />
                </Form.Item>
                <Form.Item label="职业" name="occupation">
                  <Input placeholder="例如: 见习魔法师" />
                </Form.Item>
                <Form.Item label="社会阶层" name="socialClass">
                  <Input placeholder="例如: 平民" />
                </Form.Item>
              </div>
            </Panel>

            <Panel header="2. 外貌气质设定" key="appearance">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
                <Form.Item label="身高体型" name="heightBuild">
                  <Input placeholder="例如: 180cm, 匀称体型" />
                </Form.Item>
                <Form.Item label="标志性特征" name="iconicFeatures">
                  <Input placeholder="例如: 戴着一副黑框眼镜" />
                </Form.Item>
                <Form.Item label="衣着风格" name="clothingStyle">
                  <Input placeholder="例如: 简单的修身便服" />
                </Form.Item>
                <Form.Item label="整体气质" name="overallVibe">
                  <Input placeholder="例如: 沉着冷静，眼神锐利" />
                </Form.Item>
              </div>
            </Panel>

            <Panel header="3. 性格特征设定" key="personality">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
                <Form.Item label="外在性格" name="externalPersonality">
                  <Input placeholder="例如: 待人谦和有礼，话偏少" />
                </Form.Item>
                <Form.Item label="内在性格" name="internalPersonality">
                  <Input placeholder="例如: 充满求知欲，极其护短" />
                </Form.Item>
                <Form.Item label="核心欲望" name="coreDesire">
                  <Input placeholder="例如: 探索未知，守护身边之人" />
                </Form.Item>
                <Form.Item label="恐惧与弱点" name="fearWeakness">
                  <Input placeholder="例如: 害怕重要同伴的离去" />
                </Form.Item>
                <Form.Item label="道德观念" name="moralValues">
                  <Input placeholder="例如: 坚守良知，恩怨分明" />
                </Form.Item>
                <Form.Item label="怪癖" name="quirk">
                  <Input placeholder="例如: 思考时喜欢轻转手中的笔" />
                </Form.Item>
              </div>
            </Panel>

            <Panel header="4. 故事与能力设定" key="skillsStory">
              <Form.Item label="技能专长" name="skills">
                <TextArea rows={2} placeholder="例如: 精通分析推理，对魔法理论有极高造诣" />
              </Form.Item>
              <Form.Item label="背景故事" name="backgroundStory">
                <TextArea rows={3} placeholder="输入您的身世背景或过往经历..." />
              </Form.Item>
              <Form.Item label="人际关系" name="relationships">
                <TextArea rows={2} placeholder="描述您与聊天伴侣或其他角色的关系定位..." />
              </Form.Item>
              <Form.Item label="说话方式" name="speakingStyle">
                <Input placeholder="例如: 语气平稳，喜欢理清逻辑后再发言" />
              </Form.Item>
              <Form.Item label="典型反应" name="typicalReactions">
                <TextArea rows={2} placeholder="例如: 面对挑衅会一笑置之，危机时非常可靠" />
              </Form.Item>
            </Panel>
          </Collapse>
        </div>
      </Form>
    </Modal>
  );
};
