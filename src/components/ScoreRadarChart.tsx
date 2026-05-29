import React, { useMemo } from 'react';
import ReactECharts from 'echarts-for-react';

interface RadarData {
  dimensions: Array<{ name: string; max: number }>;
  values: number[];
}

interface ScoreRadarChartProps {
  data: RadarData;
  parsedAssessment: any;
  title?: string;
}

export const ScoreRadarChart: React.FC<ScoreRadarChartProps> = ({ data, title = '大纲多维评分' }) => {
  const option = useMemo(() => {
    return {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'item',
        formatter: () => {
          let html = `<div style="padding: 8px; border-radius: 4px; background: rgba(255, 255, 255, 0.95); box-shadow: 0 4px 12px rgba(0,0,0,0.1); border: 1px solid rgba(217, 119, 87, 0.2);">`;
          html += `<div style="color: #d97757; font-weight: 600; margin-bottom: 8px;">${title}</div>`;
          data.dimensions.forEach((dim, index) => {
            const score = data.values[index];
            html += `<div style="display: flex; justify-content: space-between; gap: 24px; margin-bottom: 4px; color: #33312e; font-size: 13px;">
              <span>${dim.name}</span>
              <span style="font-weight: 500;">${score} / ${dim.max}</span>
            </div>`;
          });
          html += `</div>`;
          return html;
        },
        backgroundColor: 'transparent',
        borderWidth: 0,
        padding: 0,
        extraCssText: 'box-shadow: none;'
      },
      radar: {
        center: ['50%', '50%'],
        radius: '65%',
        splitNumber: 5,
        axisName: {
          color: '#33312e',
          fontSize: 13,
          fontWeight: 500,
        },
        splitLine: {
          lineStyle: {
            color: 'rgba(217, 119, 87, 0.15)', // #d97757 with opacity
          },
        },
        splitArea: {
          areaStyle: {
            color: [
              'rgba(217, 119, 87, 0.02)',
              'rgba(217, 119, 87, 0.04)',
              'rgba(217, 119, 87, 0.06)',
              'rgba(217, 119, 87, 0.08)',
              'rgba(217, 119, 87, 0.1)',
            ],
          },
        },
        axisLine: {
          lineStyle: {
            color: 'rgba(217, 119, 87, 0.2)',
          },
        },
        indicator: data.dimensions,
      },
      series: [
        {
          type: 'radar',
          symbol: 'circle',
          symbolSize: 6,
          itemStyle: {
            color: '#d97757', // warm amber / terracotta
          },
          lineStyle: {
            width: 2,
            color: '#d97757',
          },
          areaStyle: {
            color: 'rgba(217, 119, 87, 0.25)',
          },
          data: [
            {
              value: data.values,
              name: title,
            },
          ],
        },
      ],
    };
  }, [data]);

  return (
    <ReactECharts
      option={option}
      style={{ height: '320px', width: '100%' }}
      notMerge={true}
      lazyUpdate={true}
    />
  );
};
