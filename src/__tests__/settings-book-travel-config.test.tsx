import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import Settings from '../pages/Settings';

describe('Settings book-travel page configuration', () => {
  it('splits material page settings from book-travel page settings', () => {
    render(<Settings />);

    expect(screen.getAllByText('素材页设置')[0]).toBeInTheDocument();
    expect(screen.getAllByText('穿书页设置')[0]).toBeInTheDocument();
    expect(screen.getByText('穿书素材装配师')).toBeInTheDocument();
    expect(screen.getByText('穿书入场导演')).toBeInTheDocument();
    expect(screen.getByText('穿书剧情规划师')).toBeInTheDocument();
    expect(screen.getByText('穿书场景写手')).toBeInTheDocument();
    expect(screen.getByText('穿书记忆整理员')).toBeInTheDocument();
    expect(screen.getByText('穿书结局裁判')).toBeInTheDocument();
    expect(screen.getAllByText('温度 (Temperature)').length).toBeGreaterThanOrEqual(6);
    expect(screen.getAllByText('最大输出 Token').length).toBeGreaterThanOrEqual(6);
    expect(screen.getAllByText('最大上下文 Token').length).toBeGreaterThanOrEqual(6);
    expect(screen.getAllByText('思考深度 (Depth)').length).toBeGreaterThanOrEqual(6);
    expect(screen.getAllByText('系统提示词 (System Prompt)').length).toBeGreaterThanOrEqual(6);
  });

  it('places bond settings before material settings and book-travel settings', () => {
    render(<Settings />);

    const content = document.getElementById('settings-scroll-container');
    expect(content?.textContent?.indexOf('羁绊页设置')).toBeLessThan(content?.textContent?.indexOf('素材页设置') ?? -1);
    expect(content?.textContent?.indexOf('素材页设置')).toBeLessThan(content?.textContent?.indexOf('穿书页设置') ?? -1);
  });

  it('uses the book-travel icon for the book-travel settings section', () => {
    render(<Settings />);

    const section = document.getElementById('book-travel-config');
    expect(section?.querySelector('.anticon-deployment-unit')).toBeInTheDocument();
    expect(section?.querySelector('.anticon-compass')).not.toBeInTheDocument();
  });
});
