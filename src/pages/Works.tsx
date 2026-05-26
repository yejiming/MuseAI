import React, { useEffect, useRef, useState } from 'react';
import FileExplorer from '../components/FileExplorer';
import MarkdownEditor from '../components/MarkdownEditor';
import AgentChat from '../components/AgentChat';
import { useSettingsStore } from '../stores/useSettingsStore';
import { Button } from 'antd';
import { RobotOutlined } from '@ant-design/icons';

const MIN_FILE_TREE_WIDTH = 250;
const MAX_FILE_TREE_WIDTH = 420;
const EDITOR_MIN_WIDTH = 400;
const MIN_AGENT_WIDTH = 380;
const DEFAULT_AGENT_WIDTH = 420;
const MAX_AGENT_WIDTH = 860;

const Works: React.FC = () => {
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  
  const [fileTreeWidth, setFileTreeWidth] = useState(MIN_FILE_TREE_WIDTH);
  const [isResizingFileTree, setIsResizingFileTree] = useState(false);
  
  const [agentWidth, setAgentWidth] = useState(DEFAULT_AGENT_WIDTH);
  const [isResizingAgent, setIsResizingAgent] = useState(false);
  const [isAgentVisible, setIsAgentVisible] = useState(true);

  const fileTreeRef = useRef<HTMLDivElement>(null);
  const worksDirectory = useSettingsStore(state => state.worksDirectory);
  const setWorksDirectory = useSettingsStore(state => state.setWorksDirectory);

  // Resize File Tree
  useEffect(() => {
    if (!isResizingFileTree) return;
    const handleMouseMove = (event: MouseEvent) => {
      const fileTreeLeft = fileTreeRef.current?.getBoundingClientRect().left ?? 0;
      const nextWidth = Math.min(Math.max(event.clientX - fileTreeLeft, MIN_FILE_TREE_WIDTH), MAX_FILE_TREE_WIDTH);
      setFileTreeWidth(nextWidth);
    };
    const handleMouseUp = () => setIsResizingFileTree(false);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizingFileTree]);

  // Resize Agent
  useEffect(() => {
    if (!isResizingAgent) return;
    const handleMouseMove = (event: MouseEvent) => {
      // agent is on the right, so we calculate from the right edge
      const windowWidth = window.innerWidth;
      const nextWidth = Math.min(Math.max(windowWidth - event.clientX, MIN_AGENT_WIDTH), MAX_AGENT_WIDTH);
      setAgentWidth(nextWidth);
    };
    const handleMouseUp = () => setIsResizingAgent(false);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizingAgent]);

  return (
    <div style={{ height: '100%', width: '100%', overflowX: 'hidden', overflowY: 'hidden', background: '#faf9f5' }}>
      <div style={{ display: 'flex', height: '100%', minWidth: fileTreeWidth + EDITOR_MIN_WIDTH + (isAgentVisible ? agentWidth : 0) }}>
        {/* Left Column: File Explorer */}
        <div ref={fileTreeRef} style={{
          width: fileTreeWidth,
          minWidth: fileTreeWidth,
          position: 'relative',
          borderRight: '1px solid rgba(0, 0, 0, 0.04)',
          background: 'rgba(255, 255, 255, 0.3)'
        }}>
          <FileExplorer
            onSelectFile={setSelectedFile}
            workspacePath={worksDirectory}
            onChangeWorkspace={setWorksDirectory}
          />
          <div
            aria-label="调整文件树宽度"
            aria-orientation="vertical"
            role="separator"
            onMouseDown={() => setIsResizingFileTree(true)}
            style={{
              position: 'absolute',
              top: 0,
              right: -3,
              width: 6,
              height: '100%',
              cursor: 'col-resize',
              zIndex: 2,
            }}
          />
        </div>

        {/* Middle Column: Markdown Editor */}
        <div style={{ flex: 1, minWidth: EDITOR_MIN_WIDTH, position: 'relative' }}>
          <MarkdownEditor filePath={selectedFile} />
          {!isAgentVisible && (
            <Button
              type="primary"
              icon={<RobotOutlined />}
              onClick={() => setIsAgentVisible(true)}
              style={{
                position: 'absolute',
                top: '16px',
                right: '16px',
                background: '#d97757',
                border: 'none',
                boxShadow: '0 4px 12px rgba(217, 119, 87, 0.2)'
              }}
            >
              打开 Agent
            </Button>
          )}
        </div>

        {/* Right Column: Agent Chat */}
        {isAgentVisible && (
          <div style={{
            width: agentWidth,
            minWidth: agentWidth,
            position: 'relative',
            borderLeft: '1px solid rgba(0, 0, 0, 0.04)',
            background: '#fff',
          }}>
            <div
              aria-label="调整 Agent 宽度"
              aria-orientation="vertical"
              role="separator"
              onMouseDown={() => setIsResizingAgent(true)}
              style={{
                position: 'absolute',
                top: 0,
                left: -3,
                width: 6,
                height: '100%',
                cursor: 'col-resize',
                zIndex: 2,
              }}
            />
            <AgentChat onClose={() => setIsAgentVisible(false)} />
          </div>
        )}
      </div>
    </div>
  );
};

export default Works;
