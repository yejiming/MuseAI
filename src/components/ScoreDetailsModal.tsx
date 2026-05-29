import React, { useMemo } from 'react';
import { Modal, Typography } from 'antd';
import { ScoreRadarChart } from './ScoreRadarChart';

const { Title, Paragraph, Text } = Typography;

interface ScoreDetailsModalProps {
  isOpen: boolean;
  onClose: () => void;
  parsedAssessment: any;
  totalScore: number;
  scoreFields?: Array<{ name: string; max?: number }> | string[];
  title?: string;
  chartTitle?: string;
}

export const ScoreDetailsModal: React.FC<ScoreDetailsModalProps> = ({
  isOpen,
  onClose,
  parsedAssessment,
  totalScore,
  scoreFields,
  title = '大纲综合评分',
  chartTitle = '大纲多维评分',
}) => {
  const radarData = useMemo(() => {
    if (!parsedAssessment) return null;
    const fields = scoreFields && scoreFields.length > 0
      ? scoreFields
      : ['引流能力', '开局钩子', '设定新鲜感', '情绪爽点密度', '人设代入与话题性'];
    const dimensions = fields.map((item) => {
      if (typeof item === 'string') {
        return { name: item, max: 20 };
      }
      return { name: item.name, max: item.max || 20 };
    });
    const values = dimensions.map((d) => {
      const val = parsedAssessment[d.name];
      return typeof val === 'number' ? val : 0;
    });

    return { dimensions, values };
  }, [parsedAssessment, scoreFields]);

  // Extract suggestions from parsedAssessment
  // We'll look for string values in the parsed JSON that could represent suggestions
  const suggestions = useMemo(() => {
    if (!parsedAssessment) return [];
    const texts: { label: string; text: string }[] = [];
    
    // Some common keys that might be used for suggestions
    const suggestionKeys = ['综合建议', '优化建议', '建议', '改进方向', '整体评价'];
    
    for (const key of Object.keys(parsedAssessment)) {
      if (suggestionKeys.includes(key) && typeof parsedAssessment[key] === 'string') {
        texts.push({ label: key, text: parsedAssessment[key] });
      }
    }

    // If no explicit suggestion keys found, let's just collect any string fields
    // that are long enough to be considered a suggestion
    if (texts.length === 0) {
      for (const key of Object.keys(parsedAssessment)) {
        if (typeof parsedAssessment[key] === 'string' && parsedAssessment[key].length > 15) {
          texts.push({ label: key, text: parsedAssessment[key] });
        }
      }
    }

    return texts;
  }, [parsedAssessment]);

  return (
    <Modal
      title={null}
      open={isOpen}
      onCancel={onClose}
      footer={null}
      width={800}
      centered
      destroyOnClose
      styles={{
        body: {
          padding: 0,
          backgroundColor: '#faf9f5',
          borderRadius: 8,
          overflow: 'hidden',
        }
      }}
    >
      <div style={{ display: 'flex', minHeight: 400 }}>
        {/* Left Side: Radar Chart */}
        <div style={{ 
          flex: '0 0 380px', 
          padding: '32px 24px', 
          backgroundColor: '#ffffff',
          borderRight: '1px solid rgba(0,0,0,0.06)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center'
        }}>
          <div style={{ marginBottom: 16, textAlign: 'center' }}>
            <Title level={4} style={{ color: '#33312e', margin: 0, fontWeight: 600 }}>{title}</Title>
            <div style={{ color: '#d97757', fontSize: 36, fontWeight: 700, lineHeight: 1.2, marginTop: 8 }}>
              {totalScore} <span style={{ fontSize: 16, color: '#999', fontWeight: 400 }}>/ 100</span>
            </div>
          </div>
          
          <div style={{ width: '100%', flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {radarData ? (
              <ScoreRadarChart data={radarData} parsedAssessment={parsedAssessment} title={chartTitle} />
            ) : (
              <Text type="secondary">暂无数据</Text>
            )}
          </div>
        </div>

        {/* Right Side: Suggestions */}
        <div style={{ 
          flex: 1, 
          padding: '32px 32px 32px 24px',
          overflowY: 'auto',
          maxHeight: '600px'
        }}>
          <Title level={4} style={{ color: '#33312e', margin: 0, marginBottom: 24, fontWeight: 600 }}>优化建议</Title>
          
          {suggestions.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              {suggestions.map((item, idx) => (
                <div key={idx} style={{ 
                  backgroundColor: '#ffffff', 
                  padding: 16, 
                  borderRadius: 8,
                  boxShadow: '0 2px 8px rgba(0,0,0,0.02)',
                  border: '1px solid rgba(217, 119, 87, 0.1)'
                }}>
                  <div style={{ 
                    color: '#d97757', 
                    fontWeight: 600, 
                    marginBottom: 8,
                    fontSize: 14 
                  }}>
                    {item.label}
                  </div>
                  <Paragraph style={{ color: '#555', margin: 0, fontSize: 14, lineHeight: 1.6 }}>
                    {item.text}
                  </Paragraph>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ 
              height: '100%', 
              display: 'flex', 
              alignItems: 'center', 
              justifyContent: 'center',
              color: '#999'
            }}>
              暂无优化建议
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
};
