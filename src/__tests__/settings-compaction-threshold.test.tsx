import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import Settings from '../pages/Settings';
import { defaultAgentConfigs, useSettingsStore } from '../stores/useSettingsStore';

const thresholdLabel = '自动压缩轮数';
const samplingLabels = ['频率惩罚', '存在惩罚', 'Top P'];

function cardByTitle(title: string) {
  const titleNode = screen.getByText(title);
  const card = titleNode.closest('.ant-card');
  if (!card) {
    throw new Error(`Card not found: ${title}`);
  }
  return within(card as HTMLElement);
}

describe('Settings compaction turn threshold', () => {
  beforeEach(() => {
    act(() => {
      useSettingsStore.setState({
        agentConfigs: defaultAgentConfigs,
      });
    });
  });

  it('renders threshold only on chat and adventure agent cards', () => {
    render(<Settings />);

    expect(screen.getAllByText(thresholdLabel)).toHaveLength(3);
    samplingLabels.forEach((label) => {
      expect(screen.getAllByText(label)).toHaveLength(3);
    });
    expect(cardByTitle('伴侣对谈师').getByText(thresholdLabel)).toBeInTheDocument();
    samplingLabels.forEach((label) => {
      expect(cardByTitle('伴侣对谈师').getByText(label)).toBeInTheDocument();
    });
    expect(cardByTitle('冒险主持人（非动态加载）').getByText(thresholdLabel)).toBeInTheDocument();
    expect(cardByTitle('冒险主持人（角色卡动态加载）').getByText(thresholdLabel)).toBeInTheDocument();
    expect(cardByTitle('写文章 Agent').queryByText(thresholdLabel)).not.toBeInTheDocument();
    samplingLabels.forEach((label) => {
      expect(cardByTitle('写文章 Agent').queryByText(label)).not.toBeInTheDocument();
    });
  });

  it('saves and resets the chat agent threshold and sampling controls', async () => {
    render(<Settings />);

    const chatCard = cardByTitle('伴侣对谈师');
    const spinButtons = chatCard.getAllByRole('spinbutton');
    const thresholdInput = spinButtons[3];
    const frequencyInput = spinButtons[4];
    const presenceInput = spinButtons[5];
    const topPInput = spinButtons[6];
    expect(thresholdInput).toBeDefined();
    expect(frequencyInput).toBeDefined();
    expect(presenceInput).toBeDefined();
    expect(topPInput).toBeDefined();
    fireEvent.change(thresholdInput!, { target: { value: '12' } });
    fireEvent.change(frequencyInput!, { target: { value: '0.6' } });
    fireEvent.change(presenceInput!, { target: { value: '0.4' } });
    fireEvent.change(topPInput!, { target: { value: '0.8' } });
    fireEvent.click(chatCard.getByRole('button', { name: '保存配置' }));

    await waitFor(() => {
      expect(useSettingsStore.getState().agentConfigs.partnerChat.compactionTurnThreshold).toBe(12);
      expect(useSettingsStore.getState().agentConfigs.partnerChat.frequencyPenalty).toBe(0.6);
      expect(useSettingsStore.getState().agentConfigs.partnerChat.presencePenalty).toBe(0.4);
      expect(useSettingsStore.getState().agentConfigs.partnerChat.topP).toBe(0.8);
    });

    fireEvent.click(chatCard.getByRole('button', { name: '恢复默认' }));

    await waitFor(() => {
      expect(useSettingsStore.getState().agentConfigs.partnerChat.compactionTurnThreshold).toBe(20);
      expect(useSettingsStore.getState().agentConfigs.partnerChat.frequencyPenalty).toBe(0.3);
      expect(useSettingsStore.getState().agentConfigs.partnerChat.presencePenalty).toBe(0.2);
      expect(useSettingsStore.getState().agentConfigs.partnerChat.topP).toBe(0.9);
    });
  });
});
