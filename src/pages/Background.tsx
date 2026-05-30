import React, { useState, useEffect, useRef } from 'react';
import { Button, Input, Tooltip, Empty, Card, Tabs, Tag, Row, Col, Space, Radio } from 'antd';
import { 
  GlobalOutlined, 
  UserOutlined, 
  PlusOutlined, 
  DeleteOutlined, 
  EditOutlined,
  CompassOutlined,
  EyeOutlined,
  EditFilled
} from '@ant-design/icons';
import { usePartnerStore, PartnerItem, PartnerItemFields } from '../stores/usePartnerStore';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

const DIRECTORY_WIDTH = 280;

const Background: React.FC = () => {
  const { 
    worldBooks, 
    characterCards, 
    selectedId, 
    selectedType,
    addWorldBook,
    addCharacterCard,
    selectItem,
    deleteItem,
    updateItemName,
    updateItemFields
  } = usePartnerStore();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [activeMode, setActiveMode] = useState<'edit' | 'preview'>('edit');
  
  // Tag input states for character card
  const [tagInputVisible, setTagInputVisible] = useState(false);
  const [tagInputValue, setTagInputValue] = useState('');
  const tagInputRef = useRef<any>(null);
  const renameInputRef = useRef<any>(null);

  // Focus rename input when editing starts
  useEffect(() => {
    if (editingId && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [editingId]);

  // Focus tag input when visible
  useEffect(() => {
    if (tagInputVisible && tagInputRef.current) {
      tagInputRef.current.focus();
    }
  }, [tagInputVisible]);

  const handleStartRename = (item: PartnerItem, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingId(item.id);
    setEditName(item.name);
  };

  const handleSaveRename = (item: PartnerItem) => {
    const trimmed = editName.trim();
    if (trimmed && trimmed !== item.name) {
      updateItemName(item.id, item.type, trimmed);
    }
    setEditingId(null);
  };

  const handleDeleteItem = (id: string, type: 'world_book' | 'character_card', e: React.MouseEvent) => {
    e.stopPropagation();
    deleteItem(id, type);
  };

  // Find currently selected item
  const selectedItem = selectedType === 'world_book' 
    ? worldBooks.find(b => b.id === selectedId) 
    : characterCards.find(c => c.id === selectedId);

  // Sync editName when item name changes or new item is selected
  const handleFieldChange = (key: keyof PartnerItemFields, value: any) => {
    if (selectedItem) {
      updateItemFields(selectedItem.id, selectedItem.type, { [key]: value });
    }
  };

  // Tag manipulation for Character Card
  const handleRemoveTag = (removedTag: string) => {
    if (selectedItem) {
      const currentTags = selectedItem.fields?.identityTags || [];
      const nextTags = currentTags.filter(tag => tag !== removedTag);
      handleFieldChange('identityTags', nextTags);
    }
  };

  const handleAddTagConfirm = () => {
    if (selectedItem && tagInputValue.trim()) {
      const currentTags = selectedItem.fields?.identityTags || [];
      if (!currentTags.includes(tagInputValue.trim())) {
        const nextTags = [...currentTags, tagInputValue.trim()];
        handleFieldChange('identityTags', nextTags);
      }
    }
    setTagInputVisible(false);
    setTagInputValue('');
  };

  const showTagInput = () => {
    setTagInputVisible(true);
  };

  const renderDirectoryItem = (item: PartnerItem) => {
    const isSelected = selectedId === item.id;
    const isEditing = editingId === item.id;

    return (
      <div
        key={item.id}
        onClick={() => selectItem(item.id, item.type)}
        onDoubleClick={(e) => handleStartRename(item, e)}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 12px',
          margin: '4px 8px',
          borderRadius: '6px',
          cursor: 'pointer',
          background: isSelected ? '#f2e8dc' : 'transparent',
          color: isSelected ? '#d97757' : '#33312e',
          transition: 'all 0.2s cubic-bezier(0.25, 0.8, 0.25, 1)',
          position: 'relative',
        }}
        className="directory-item-hover"
      >
        <div style={{ display: 'flex', alignItems: 'center', flex: 1, minWidth: 0, gap: 8 }}>
          {item.type === 'world_book' ? (
            <GlobalOutlined style={{ fontSize: 15, flexShrink: 0, color: isSelected ? '#d97757' : '#8c8882' }} />
          ) : (
            <UserOutlined style={{ fontSize: 15, flexShrink: 0, color: isSelected ? '#d97757' : '#8c8882' }} />
          )}

          {isEditing ? (
            <Input
              ref={renameInputRef}
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onBlur={() => handleSaveRename(item)}
              onPressEnter={() => handleSaveRename(item)}
              size="small"
              style={{
                height: 22,
                padding: '0 4px',
                fontSize: 13,
                borderColor: '#d97757',
              }}
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <span style={{ 
              fontSize: 13, 
              overflow: 'hidden', 
              textOverflow: 'ellipsis', 
              whiteSpace: 'nowrap',
              fontWeight: isSelected ? 500 : 400
            }}>
              {item.name}
            </span>
          )}
        </div>

        {!isEditing && (
          <div className="directory-item-actions" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <Tooltip title="重命名" mouseEnterDelay={0.8}>
              <Button 
                type="text" 
                size="small" 
                icon={<EditOutlined style={{ fontSize: 12 }} />} 
                onClick={(e) => handleStartRename(item, e)}
                style={{ width: 20, height: 20, padding: 0, display: 'none' }}
                className="action-btn"
              />
            </Tooltip>
            <Tooltip title="删除" mouseEnterDelay={0.8}>
              <Button 
                type="text" 
                danger
                size="small" 
                icon={<DeleteOutlined style={{ fontSize: 12 }} />} 
                onClick={(e) => handleDeleteItem(item.id, item.type, e)}
                style={{ width: 20, height: 20, padding: 0, display: 'none' }}
                className="action-btn"
              />
            </Tooltip>
          </div>
        )}
      </div>
    );
  };

  // Rendering World Book Config UI
  const renderWorldBookForm = (item: PartnerItem) => {
    const fields = item.fields || {};

    return (
      <Space direction="vertical" size={20} style={{ width: '100%' }}>
        <Card className="custom-form-card" title={<span className="form-section-title"><CompassOutlined style={{ color: '#d97757' }} /> 基本世界设定</span>} size="small">
          <Row gutter={[16, 16]}>
            <Col span={12}>
              <div className="input-label">世界名称</div>
              <Input 
                value={item.name} 
                className="custom-form-input"
                placeholder="请输入世界观名称"
                onChange={(e) => updateItemName(item.id, item.type, e.target.value)}
              />
            </Col>
            <Col span={12}>
              <div className="input-label">核心主题</div>
              <Input 
                value={fields.theme || ''} 
                className="custom-form-input"
                placeholder="例如：魔法冒险 / 奇幻史诗 / 蒸汽朋克"
                onChange={(e) => handleFieldChange('theme', e.target.value)}
              />
            </Col>
            <Col span={8}>
              <div className="input-label">时代背景</div>
              <Input 
                value={fields.era || ''} 
                className="custom-form-input"
                placeholder="例如：魔法工业时代 / 中世纪末期"
                onChange={(e) => handleFieldChange('era', e.target.value)}
              />
            </Col>
            <Col span={8}>
              <div className="input-label">科技水平</div>
              <Input 
                value={fields.techLevel || ''} 
                className="custom-form-input"
                placeholder="例如：蒸汽机与简单电气"
                onChange={(e) => handleFieldChange('techLevel', e.target.value)}
              />
            </Col>
            <Col span={8}>
              <div className="input-label">魔法水平</div>
              <Input 
                value={fields.magicLevel || ''} 
                className="custom-form-input"
                placeholder="例如：高魔世界 / 以太广泛应用"
                onChange={(e) => handleFieldChange('magicLevel', e.target.value)}
              />
            </Col>
          </Row>
        </Card>

        <Card className="custom-form-card" title={<span className="form-section-title"><GlobalOutlined style={{ color: '#d97757' }} /> 核心世界观架构</span>} size="small">
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <div>
              <div className="input-label">地理格局</div>
              <Input.TextArea 
                value={fields.geography || ''} 
                autoSize={{ minRows: 2, maxRows: 6 }}
                className="custom-form-input"
                placeholder="描述大陆分布、主要地理特征及气候格局..."
                onChange={(e) => handleFieldChange('geography', e.target.value)}
              />
            </div>
            <div>
              <div className="input-label">关键场景</div>
              <Input.TextArea 
                value={fields.keyScenes || ''} 
                autoSize={{ minRows: 2, maxRows: 6 }}
                className="custom-form-input"
                placeholder="列出故事展开的核心场景地标，如“奥兰魔法学院大图书馆”..."
                onChange={(e) => handleFieldChange('keyScenes', e.target.value)}
              />
            </div>
            <div>
              <div className="input-label">文化特色</div>
              <Input.TextArea 
                value={fields.culturalFeatures || ''} 
                autoSize={{ minRows: 2, maxRows: 6 }}
                className="custom-form-input"
                placeholder="描述各族群的风俗习惯、宗教信仰、以及对魔法/科技的社会观念..."
                onChange={(e) => handleFieldChange('culturalFeatures', e.target.value)}
              />
            </div>
            <div>
              <div className="input-label">历史事件</div>
              <Input.TextArea 
                value={fields.history || ''} 
                autoSize={{ minRows: 2, maxRows: 6 }}
                className="custom-form-input"
                placeholder="列出世界观下具有深远影响的历史大战、协议签署或重大转折点..."
                onChange={(e) => handleFieldChange('history', e.target.value)}
              />
            </div>
            <div>
              <div className="input-label">核心矛盾</div>
              <Input.TextArea 
                value={fields.conflict || ''} 
                autoSize={{ minRows: 2, maxRows: 6 }}
                className="custom-form-input"
                placeholder="描述当前世界最激烈的矛盾冲突，如“魔法保守势力与科技工业党派的对立”..."
                onChange={(e) => handleFieldChange('conflict', e.target.value)}
              />
            </div>
          </Space>
        </Card>
      </Space>
    );
  };

  // Rendering Character Card Config UI
  const renderCharacterCardForm = (item: PartnerItem) => {
    const fields = item.fields || {};

    const tabItems = [
      {
        key: '1',
        label: '基础与标签',
        children: (
          <Space direction="vertical" size={16} style={{ width: '100%', marginTop: 8 }}>
            <Card className="custom-sub-card" title="基本身份信息" size="small">
              <Row gutter={[16, 12]}>
                <Col span={12}>
                  <div className="input-label">姓名</div>
                  <Input 
                    value={item.name} 
                    className="custom-form-input"
                    placeholder="请输入角色姓名"
                    onChange={(e) => updateItemName(item.id, item.type, e.target.value)}
                  />
                </Col>
                <Col span={6}>
                  <div className="input-label">年龄</div>
                  <Input 
                    value={fields.age || ''} 
                    className="custom-form-input"
                    placeholder="例如：18岁"
                    onChange={(e) => handleFieldChange('age', e.target.value)}
                  />
                </Col>
                <Col span={6}>
                  <div className="input-label">性别</div>
                  <Input 
                    value={fields.gender || ''} 
                    className="custom-form-input"
                    placeholder="例如：男"
                    onChange={(e) => handleFieldChange('gender', e.target.value)}
                  />
                </Col>
                <Col span={8}>
                  <div className="input-label">种族</div>
                  <Input 
                    value={fields.race || ''} 
                    className="custom-form-input"
                    placeholder="例如：人类 / 精灵"
                    onChange={(e) => handleFieldChange('race', e.target.value)}
                  />
                </Col>
                <Col span={8}>
                  <div className="input-label">出生地</div>
                  <Input 
                    value={fields.birthplace || ''} 
                    className="custom-form-input"
                    placeholder="例如：边境小镇"
                    onChange={(e) => handleFieldChange('birthplace', e.target.value)}
                  />
                </Col>
                <Col span={8}>
                  <div className="input-label">职业</div>
                  <Input 
                    value={fields.occupation || ''} 
                    className="custom-form-input"
                    placeholder="例如：学院高级学员"
                    onChange={(e) => handleFieldChange('occupation', e.target.value)}
                  />
                </Col>
                <Col span={24}>
                  <div className="input-label">社会阶层</div>
                  <Input 
                    value={fields.socialClass || ''} 
                    className="custom-form-input"
                    placeholder="描述角色的社会地位，例如：“平民出身，凭天赋获得奖学金入学”"
                    onChange={(e) => handleFieldChange('socialClass', e.target.value)}
                  />
                </Col>
              </Row>
            </Card>

            <Card className="custom-sub-card" title="身份标签 (按回车或失去焦点保存)" size="small">
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 4px', alignItems: 'center' }}>
                {(fields.identityTags || []).map((tag) => (
                  <Tag
                    key={tag}
                    closable
                    onClose={() => handleRemoveTag(tag)}
                    style={{
                      backgroundColor: '#faf6f0',
                      border: '1px solid #f2e8dc',
                      color: '#d97757',
                      fontSize: 13,
                      padding: '4px 10px',
                      borderRadius: 4,
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4
                    }}
                  >
                    {tag}
                  </Tag>
                ))}
                {tagInputVisible ? (
                  <Input
                    ref={tagInputRef}
                    type="text"
                    size="small"
                    style={{ width: 100, height: 26 }}
                    value={tagInputValue}
                    onChange={(e) => setTagInputValue(e.target.value)}
                    onBlur={handleAddTagConfirm}
                    onPressEnter={handleAddTagConfirm}
                  />
                ) : (
                  <Button 
                    type="dashed" 
                    size="small" 
                    icon={<PlusOutlined />} 
                    onClick={showTagInput}
                    style={{ 
                      height: 26, 
                      fontSize: 12, 
                      borderRadius: 4,
                      color: '#8c8882',
                      borderColor: 'rgba(0,0,0,0.1)'
                    }}
                  >
                    新增标签
                  </Button>
                )}
              </div>
            </Card>
          </Space>
        )
      },
      {
        key: '2',
        label: '外貌与性格',
        children: (
          <Space direction="vertical" size={16} style={{ width: '100%', marginTop: 8 }}>
            <Card className="custom-sub-card" title="外貌气质设定" size="small">
              <Space direction="vertical" size={12} style={{ width: '100%' }}>
                <Row gutter={16}>
                  <Col span={12}>
                    <div className="input-label">身高体型</div>
                    <Input 
                      value={fields.heightBuild || ''} 
                      className="custom-form-input"
                      placeholder="如：“178cm，体型匀称偏瘦”"
                      onChange={(e) => handleFieldChange('heightBuild', e.target.value)}
                    />
                  </Col>
                  <Col span={12}>
                    <div className="input-label">标志性特征</div>
                    <Input 
                      value={fields.iconicFeatures || ''} 
                      className="custom-form-input"
                      placeholder="如：“手背上有淡蓝色以太烙印”"
                      onChange={(e) => handleFieldChange('iconicFeatures', e.target.value)}
                    />
                  </Col>
                </Row>
                <div>
                  <div className="input-label">衣着风格</div>
                  <Input.TextArea 
                    value={fields.clothingStyle || ''} 
                    autoSize={{ minRows: 1, maxRows: 3 }}
                    className="custom-form-input"
                    placeholder="描述角色常穿服饰及随身携带的物品..."
                    onChange={(e) => handleFieldChange('clothingStyle', e.target.value)}
                  />
                </div>
                <div>
                  <div className="input-label">整体气质</div>
                  <Input.TextArea 
                    value={fields.overallVibe || ''} 
                    autoSize={{ minRows: 1, maxRows: 3 }}
                    className="custom-form-input"
                    placeholder="给旁人留下的直观感觉，如“温和沉静，偶尔闪过警惕”..."
                    onChange={(e) => handleFieldChange('overallVibe', e.target.value)}
                  />
                </div>
              </Space>
            </Card>

            <Card className="custom-sub-card" title="性格内里特征" size="small">
              <Space direction="vertical" size={12} style={{ width: '100%' }}>
                <Row gutter={16}>
                  <Col span={12}>
                    <div className="input-label">外在性格 (表现给外界看的一面)</div>
                    <Input.TextArea 
                      value={fields.externalPersonality || ''} 
                      autoSize={{ minRows: 1, maxRows: 3 }}
                      className="custom-form-input"
                      placeholder="如：“温和谦逊，乐于助人，靠谱同伴”"
                      onChange={(e) => handleFieldChange('externalPersonality', e.target.value)}
                    />
                  </Col>
                  <Col span={12}>
                    <div className="input-label">内在性格 (真实的自我本质)</div>
                    <Input.TextArea 
                      value={fields.internalPersonality || ''} 
                      autoSize={{ minRows: 1, maxRows: 3 }}
                      className="custom-form-input"
                      placeholder="如：“冷静克制，心防极重，权衡明确”"
                      onChange={(e) => handleFieldChange('internalPersonality', e.target.value)}
                    />
                  </Col>
                </Row>
                <Row gutter={16}>
                  <Col span={12}>
                    <div className="input-label">核心欲望 (内在的最强驱动力)</div>
                    <Input.TextArea 
                      value={fields.coreDesire || ''} 
                      autoSize={{ minRows: 1, maxRows: 3 }}
                      className="custom-form-input"
                      placeholder="如：“探寻魔法底层原理，安全回家”"
                      onChange={(e) => handleFieldChange('coreDesire', e.target.value)}
                    />
                  </Col>
                  <Col span={12}>
                    <div className="input-label">恐惧与弱点 (最大的软肋)</div>
                    <Input.TextArea 
                      value={fields.fearWeakness || ''} 
                      autoSize={{ minRows: 1, maxRows: 3 }}
                      className="custom-form-input"
                      placeholder="如：“穿越的秘密泄露被当成异端净化”"
                      onChange={(e) => handleFieldChange('fearWeakness', e.target.value)}
                    />
                  </Col>
                </Row>
                <Row gutter={16}>
                  <Col span={12}>
                    <div className="input-label">道德观念 (是非对错底线)</div>
                    <Input.TextArea 
                      value={fields.moralValues || ''} 
                      autoSize={{ minRows: 1, maxRows: 3 }}
                      className="custom-form-input"
                      placeholder="如：“不主动害人，安全受威胁时果断反击”"
                      onChange={(e) => handleFieldChange('moralValues', e.target.value)}
                    />
                  </Col>
                  <Col span={12}>
                    <div className="input-label">怪癖 (独特有趣的习惯动作)</div>
                    <Input.TextArea 
                      value={fields.quirk || ''} 
                      autoSize={{ minRows: 1, maxRows: 3 }}
                      className="custom-form-input"
                      placeholder="如：“思考难题时下意识用食指轻敲太阳穴”"
                      onChange={(e) => handleFieldChange('quirk', e.target.value)}
                    />
                  </Col>
                </Row>
              </Space>
            </Card>
          </Space>
        )
      },
      {
        key: '3',
        label: '能力与经历',
        children: (
          <Space direction="vertical" size={16} style={{ width: '100%', marginTop: 8 }}>
            <Card className="custom-sub-card" title="硬核能力与经历" size="small">
              <Space direction="vertical" size={12} style={{ width: '100%' }}>
                <div>
                  <div className="input-label">技能专长</div>
                  <Input.TextArea 
                    value={fields.skills || ''} 
                    autoSize={{ minRows: 2, maxRows: 5 }}
                    className="custom-form-input"
                    placeholder="描述角色掌握的魔法、体术、科学知识或其他特长..."
                    onChange={(e) => handleFieldChange('skills', e.target.value)}
                  />
                </div>
                <div>
                  <div className="input-label">背景故事</div>
                  <Input.TextArea 
                    value={fields.backgroundStory || ''} 
                    autoSize={{ minRows: 3, maxRows: 6 }}
                    className="custom-form-input"
                    placeholder="记叙角色过去的重要成长事件，如何成为现在的自己..."
                    onChange={(e) => handleFieldChange('backgroundStory', e.target.value)}
                  />
                </div>
                <div>
                  <div className="input-label">人际关系</div>
                  <Input.TextArea 
                    value={fields.relationships || ''} 
                    autoSize={{ minRows: 2, maxRows: 5 }}
                    className="custom-form-input"
                    placeholder="描述与配角、敌对势力、导师或死党的关系关联..."
                    onChange={(e) => handleFieldChange('relationships', e.target.value)}
                  />
                </div>
              </Space>
            </Card>

            <Card className="custom-sub-card" title="语言表达风格" size="small">
              <Space direction="vertical" size={12} style={{ width: '100%' }}>
                <div>
                  <div className="input-label">说话方式</div>
                  <Input.TextArea 
                    value={fields.speakingStyle || ''} 
                    autoSize={{ minRows: 2, maxRows: 4 }}
                    className="custom-form-input"
                    placeholder="口癖、语气节奏，如：“语气不温不火，喜欢用'根据我的观察...'”..."
                    onChange={(e) => handleFieldChange('speakingStyle', e.target.value)}
                  />
                </div>
                <div>
                  <div className="input-label">典型反应</div>
                  <Input.TextArea 
                    value={fields.typicalReactions || ''} 
                    autoSize={{ minRows: 2, maxRows: 4 }}
                    className="custom-form-input"
                    placeholder="遇到不同突发事件的本能反应，如“遭遇危机时瞳孔微缩但绝不惊慌”..."
                    onChange={(e) => handleFieldChange('typicalReactions', e.target.value)}
                  />
                </div>
              </Space>
            </Card>
          </Space>
        )
      }
    ];

    return (
      <div className="custom-tab" style={{ width: '100%' }}>
        <Tabs items={tabItems} defaultActiveKey="1" size="middle" />
      </div>
    );
  };

  return (
    <div style={{ display: 'flex', height: '100%', width: '100%', overflow: 'hidden', background: '#faf9f5' }}>
      {/* CSS injection for aesthetic styling and theme preservation */}
      <style>{`
        .directory-item-hover:hover {
          background-color: #faf6f0;
        }
        .directory-item-hover:hover .action-btn {
          display: inline-flex !important;
        }
        .directory-item-hover .action-btn:hover {
          background-color: rgba(0, 0, 0, 0.04) !important;
        }
        .add-category-btn {
          color: #8c8882;
          transition: all 0.2s;
        }
        .add-category-btn:hover {
          color: #d97757 !important;
          background-color: #f2e8dc !important;
        }
        
        /* Premium custom styles for inputs and forms */
        .input-label {
          font-size: 12px;
          color: #8c8882;
          font-weight: 500;
          margin-bottom: 6px;
        }
        .custom-form-input {
          border-radius: 6px !important;
          border: 1px solid rgba(0, 0, 0, 0.08) !important;
          transition: all 0.2s !important;
          font-family: inherit !important;
        }
        .custom-form-input:focus, .custom-form-input-focused {
          border-color: #d97757 !important;
          box-shadow: 0 0 0 2px rgba(217, 119, 87, 0.1) !important;
        }
        .custom-form-input:hover {
          border-color: #d97757 !important;
        }
        .form-section-title {
          font-size: 14px;
          font-weight: 600;
          color: #33312e;
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .custom-form-card {
          background: #ffffff !important;
          border: 1px solid rgba(0, 0, 0, 0.03) !important;
          border-radius: 8px !important;
          box-shadow: 0 2px 8px rgba(0,0,0,0.01) !important;
        }
        .custom-form-card .ant-card-head {
          border-bottom: 1px solid rgba(0,0,0,0.02) !important;
          background: #fafafa !important;
          border-top-left-radius: 8px !important;
          border-top-right-radius: 8px !important;
        }
        .custom-sub-card {
          background: #ffffff !important;
          border: 1px solid rgba(0, 0, 0, 0.03) !important;
          border-radius: 8px !important;
          box-shadow: 0 1px 4px rgba(0,0,0,0.01) !important;
        }
        .custom-sub-card .ant-card-head {
          border-bottom: 1px solid rgba(0,0,0,0.02) !important;
          background: #fbfbfa !important;
          font-size: 13px !important;
          font-weight: 500 !important;
        }
        
        /* Custom tabs styling in warm palette */
        .custom-tab .ant-tabs-nav::before {
          border-bottom: 1px solid rgba(0,0,0,0.03) !important;
        }
        .custom-tab .ant-tabs-tab {
          padding: 8px 12px !important;
        }
        .custom-tab .ant-tabs-tab-btn {
          color: #8c8882 !important;
          font-weight: 400 !important;
        }
        .custom-tab .ant-tabs-tab-btn:hover {
          color: #d97757 !important;
        }
        .custom-tab .ant-tabs-tab-active .ant-tabs-tab-btn {
          color: #d97757 !important;
          font-weight: 600 !important;
        }
        .custom-tab .ant-tabs-ink-bar {
          background: #d97757 !important;
          height: 2px !important;
        }
        
        /* Premium Magazine-like preview styling */
        .markdown-preview-container {
          background-color: #ffffff;
          padding: 32px 40px;
          border-radius: 8px;
          border: 1px solid rgba(0, 0, 0, 0.03);
          box-shadow: 0 4px 16px rgba(0, 0, 0, 0.01);
          color: #33312e;
          font-family: Georgia, -apple-system-font, "STSong", "Songti SC", serif;
          line-height: 1.8;
          font-size: 15px;
          max-width: 760px;
          margin: 0 auto;
          width: 100%;
        }
        .markdown-preview-container h1 {
          font-size: 26px;
          font-weight: 700;
          border-bottom: 2px solid #f2e8dc;
          padding-bottom: 10px;
          margin-bottom: 24px;
          color: #33312e;
          text-align: center;
        }
        .markdown-preview-container h2 {
          font-size: 18px;
          font-weight: 600;
          margin-top: 28px;
          margin-bottom: 16px;
          color: #d97757;
          border-left: 3px solid #d97757;
          padding-left: 10px;
        }
        .markdown-preview-container p {
          margin-bottom: 16px;
          text-align: justify;
        }
        .markdown-preview-container ul {
          padding-left: 20px;
          margin-bottom: 18px;
        }
        .markdown-preview-container li {
          margin-bottom: 8px;
        }
        .markdown-preview-container code {
          background-color: #faf6f0;
          color: #d97757;
          padding: 2px 6px;
          border-radius: 4px;
          font-size: 13px;
          font-family: Consolas, Monaco, monospace;
        }
      `}</style>

      {/* Left Directory Sidebar */}
      <div style={{ 
        width: DIRECTORY_WIDTH, 
        minWidth: DIRECTORY_WIDTH, 
        borderRight: '1px solid rgba(0, 0, 0, 0.04)', 
        display: 'flex', 
        flexDirection: 'column',
        background: '#ffffff'
      }}>
        {/* Title Header */}
        <div style={{ 
          padding: '16px 20px', 
          borderBottom: '1px solid rgba(0, 0, 0, 0.02)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between'
        }}>
          <span style={{ 
            fontSize: 16, 
            fontWeight: 600, 
            color: '#33312e',
            fontFamily: '"Inter", sans-serif'
          }}>
            背景设定
          </span>
        </div>

        {/* Directory Scrollable Area */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 0' }}>
          
          {/* World Book Category */}
          <div>
            <div style={{ 
              display: 'flex', 
              alignItems: 'center', 
              justifyContent: 'space-between',
              padding: '4px 16px 4px 20px',
              color: '#8c8882',
              fontSize: 12,
              fontWeight: 500,
              letterSpacing: '0.05em'
            }}>
              <span>世界书</span>
              <Tooltip title="新增世界书">
                <Button 
                  type="text" 
                  size="small" 
                  icon={<PlusOutlined style={{ fontSize: 12 }} />} 
                  onClick={addWorldBook}
                  style={{ width: 22, height: 22, padding: 0 }}
                  className="add-category-btn"
                />
              </Tooltip>
            </div>
            
            <div style={{ marginBottom: 16 }}>
              {worldBooks.length === 0 ? (
                <div style={{ padding: '8px 20px', color: '#c0bbb4', fontSize: 12, fontStyle: 'italic' }}>
                  暂无世界书
                </div>
              ) : (
                worldBooks.map(renderDirectoryItem)
              )}
            </div>
          </div>

          {/* Character Card Category */}
          <div>
            <div style={{ 
              display: 'flex', 
              alignItems: 'center', 
              justifyContent: 'space-between',
              padding: '4px 16px 4px 20px',
              color: '#8c8882',
              fontSize: 12,
              fontWeight: 500,
              letterSpacing: '0.05em'
            }}>
              <span>角色卡</span>
              <Tooltip title="新增角色卡">
                <Button 
                  type="text" 
                  size="small" 
                  icon={<PlusOutlined style={{ fontSize: 12 }} />} 
                  onClick={addCharacterCard}
                  style={{ width: 22, height: 22, padding: 0 }}
                  className="add-category-btn"
                />
              </Tooltip>
            </div>
            
            <div>
              {characterCards.length === 0 ? (
                <div style={{ padding: '8px 20px', color: '#c0bbb4', fontSize: 12, fontStyle: 'italic' }}>
                  暂无角色卡
                </div>
              ) : (
                characterCards.map(renderDirectoryItem)
              )}
            </div>
          </div>

        </div>
      </div>

      {/* Right Config Panel */}
      <div style={{ 
        flex: 1, 
        display: 'flex', 
        flexDirection: 'column', 
        overflow: 'hidden' 
      }}>
        {selectedItem ? (
          <div style={{ 
            display: 'flex', 
            flexDirection: 'column', 
            height: '100%', 
            width: '100%' 
          }}>
            {/* Header */}
            <div style={{ 
              padding: '12px 24px', 
              background: '#ffffff', 
              borderBottom: '1px solid rgba(0, 0, 0, 0.04)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              height: 52
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                {selectedItem.type === 'world_book' ? (
                  <GlobalOutlined style={{ fontSize: 16, color: '#d97757' }} />
                ) : (
                  <UserOutlined style={{ fontSize: 16, color: '#d97757' }} />
                )}
                <span style={{ fontSize: 15, fontWeight: 600, color: '#33312e' }}>
                  {selectedItem.name}
                </span>
                <span style={{ 
                  fontSize: 10, 
                  background: '#f2e8dc', 
                  color: '#d97757', 
                  padding: '2px 8px', 
                  borderRadius: 12, 
                  fontWeight: 500
                }}>
                  {selectedItem.type === 'world_book' ? '世界书' : '角色卡'}
                </span>
              </div>

              {/* Mode Toggle Selector */}
              <Radio.Group 
                value={activeMode} 
                onChange={(e) => setActiveMode(e.target.value)}
                size="small"
                style={{
                  padding: 2,
                  background: '#faf9f5',
                  borderRadius: 6,
                  border: '1px solid rgba(0,0,0,0.03)'
                }}
              >
                <Radio.Button 
                  value="edit"
                  style={{
                    borderRadius: 4,
                    border: 'none',
                    background: activeMode === 'edit' ? '#ffffff' : 'transparent',
                    color: activeMode === 'edit' ? '#d97757' : '#8c8882',
                    boxShadow: activeMode === 'edit' ? '0 1px 4px rgba(0,0,0,0.05)' : 'none',
                    fontWeight: activeMode === 'edit' ? 500 : 400
                  }}
                >
                  <Space size={4}>
                    <EditFilled style={{ fontSize: 11 }} />
                    <span>编辑配置</span>
                  </Space>
                </Radio.Button>
                <Radio.Button 
                  value="preview"
                  style={{
                    borderRadius: 4,
                    border: 'none',
                    background: activeMode === 'preview' ? '#ffffff' : 'transparent',
                    color: activeMode === 'preview' ? '#d97757' : '#8c8882',
                    boxShadow: activeMode === 'preview' ? '0 1px 4px rgba(0,0,0,0.05)' : 'none',
                    fontWeight: activeMode === 'preview' ? 500 : 400
                  }}
                >
                  <Space size={4}>
                    <EyeOutlined style={{ fontSize: 11 }} />
                    <span>效果预览</span>
                  </Space>
                </Radio.Button>
              </Radio.Group>
            </div>

            {/* Scrollable Work Area */}
            <div style={{ 
              flex: 1, 
              padding: '24px 32px 40px 32px', 
              overflowY: 'auto',
              background: '#faf9f5'
            }}>
              {activeMode === 'edit' ? (
                // Form Editor View
                <div style={{ maxWidth: 900, margin: '0 auto', width: '100%' }}>
                  {selectedItem.type === 'world_book' 
                    ? renderWorldBookForm(selectedItem) 
                    : renderCharacterCardForm(selectedItem)
                  }
                </div>
              ) : (
                // Elegant Markdown Preview View
                <div className="markdown-preview-container">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {selectedItem.content}
                  </ReactMarkdown>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div style={{ 
            flex: 1, 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center', 
            background: '#faf9f5' 
          }}>
            <Empty
              image={<CompassOutlined style={{ fontSize: 64, color: '#c0bbb4' }} />}
              description={
                <span style={{ color: '#8c8882', fontSize: 14 }}>
                  请在左侧目录中选择或新建一个世界书或角色卡来查看配置。
                </span>
              }
            />
          </div>
        )}
      </div>
    </div>
  );
};

export default Background;
