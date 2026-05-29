const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '../src/pages/DeAi.tsx');
let content = fs.readFileSync(file, 'utf8');

// 1. Remove buildRecentSuggestionText since we will construct it manually for both.
content = content.replace(/  const buildRecentSuggestionText = \([\s\S]*?  \};\n\n/g, '');

// 2. Redefine buildDetectorPrompt
const buildDetectorPromptNew = `  const buildDetectorPrompt = (versionId: string, historySuggestions: VersionInfo[]) => {
    let recentSuggestionText = '暂无历史修改建议。';
    if (historySuggestions.length > 0) {
      recentSuggestionText = historySuggestions.map((v, i) => \`\${i + 1}. 版本 \${new Date(v.timestamp).toLocaleString()} (AI味: \${v.aiScore ?? '--'})：\\n\${v.suggestion!.trim()}\`).join('\\n\\n');
    }
    return \`请分析作品: \${getVersionPath(selectedWorkFile!, versionId)}\\n\\n本次检测使用以下范文路径作为参考：\\n\${selectedDetectorReferences.join('\\n')}\\n\\n你带上的历史版本检测AI味Agent给出的修改建议，请作为本次判断参考：\\n\${recentSuggestionText}\\n\\n请重点判断当前文章是否仍然存在这些旧问题，或是否因为此前修改出现矫枉过正。\`;
  };`;

content = content.replace(/  const buildDetectorPrompt = \([\s\S]*?\);\n/g, buildDetectorPromptNew + '\n');

// 3. Update handleDetectorBeforeStart
const handleDetectorBeforeStartNew = `  const handleDetectorBeforeStart = async () => {
    if (!selectedWorkFile) return;
    const confirmed = await confirmDetectorWithoutReferences();
    if (!confirmed) return;
    const latestVersions = await refreshVersions(activeVersionId);
    
    // Filter out history suggestions based on selectedHistoricalVersions (exclude activeVersionId if it exists)
    const historySuggestions = latestVersions
      .filter(v => v.id !== activeVersionId && v.suggestion?.trim() && selectedHistoricalVersions.includes(v.id))
      .sort((a, b) => b.timestamp - a.timestamp);

    if (activeVersionId) {
      detectorTargetVersionIdRef.current = activeVersionId;
      return buildDetectorPrompt(activeVersionId, historySuggestions);
    }
    try {
      const newVersion = await invoke<VersionInfo>('create_file_version', { path: selectedWorkFile });
      setVersions([newVersion, ...latestVersions]);
      setActiveVersionId(newVersion.id);
      syncActiveVersionResult(newVersion);
      detectorTargetVersionIdRef.current = newVersion.id;
      return buildDetectorPrompt(newVersion.id, historySuggestions);
    } catch (e) {
      message.error(\`创建检测版本失败: \${e}\`);
      throw e;
    }
  };`;

content = content.replace(/  const handleDetectorBeforeStart = async \(\) => \{[\s\S]*?    \} catch \(e\) \{\n      message\.error\(`创建检测版本失败: \$\{e\}`\);\n      throw e;\n    \}\n  \};\n/g, handleDetectorBeforeStartNew + '\n');


// 4. Update Modal render section in JSX
// Find the Modals and replace them
const modalsOldRegex = /      <Modal\n        title="选择带上的历史版本检测AI味建议"[\s\S]*?      <\/Modal>\n      <Modal\n        title="选择检测范文"[\s\S]*?      <\/Modal>/;

const modalsNew = `      <Modal
        title="去除AI味 Agent 设置"
        open={isRemoverSettingsOpen}
        okText="确定"
        cancelText="取消"
        width={500}
        onCancel={() => setIsRemoverSettingsOpen(false)}
        onOk={() => setIsRemoverSettingsOpen(false)}
      >
        <Typography.Text strong style={{ display: 'block', marginBottom: 8 }}>选择带上的历史版本检测AI味建议</Typography.Text>
        <div className="de-ai-reference-picker" style={{ maxHeight: 300, overflowY: 'auto' }}>
          {versions.filter(v => v.id !== activeVersionId && v.suggestion?.trim()).length > 0 ? (
            <Tree
              blockNode
              checkable
              checkedKeys={selectedHistoricalVersions}
              onCheck={(checkedKeys) => {
                const keys = Array.isArray(checkedKeys) ? checkedKeys : checkedKeys.checked;
                setSelectedHistoricalVersions(keys.map(String));
              }}
              selectable={false}
              treeData={versions.filter(v => v.id !== activeVersionId && v.suggestion?.trim()).map((v) => ({
                title: \`版本 \${new Date(v.timestamp).toLocaleString()} (AI味: \${v.aiScore ?? '--'})\`,
                key: v.id,
              }))}
            />
          ) : (
            <Empty description="暂无可用的历史版本建议" />
          )}
        </div>
      </Modal>
      <Modal
        title="检测AI味 Agent 设置"
        open={isDetectorSettingsOpen}
        okText="确定"
        cancelText="取消"
        width={640}
        onCancel={() => setIsDetectorSettingsOpen(false)}
        onOk={() => setIsDetectorSettingsOpen(false)}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24, maxHeight: '60vh', overflowY: 'auto' }}>
          <div>
            <Typography.Text strong style={{ display: 'block', marginBottom: 8 }}>选择检测范文</Typography.Text>
            <div className="de-ai-reference-picker" style={{ maxHeight: 200, overflowY: 'auto', border: '1px solid #f0f0f0', borderRadius: 6 }}>
              {allReferenceFiles.length > 0 ? (
                <Tree
                  blockNode
                  checkable
                  checkedKeys={selectedDetectorReferences}
                  className="de-ai-reference-picker__tree"
                  onCheck={(checkedKeys) => {
                    const keys = Array.isArray(checkedKeys) ? checkedKeys : checkedKeys.checked;
                    setSelectedDetectorReferences(keys.map(String).filter((key) => allReferenceFiles.includes(key)));
                  }}
                  selectable={false}
                  treeData={mapReferenceTreeData(referenceTree)}
                />
              ) : (
                <Empty description="范文目录暂无可选文件" />
              )}
            </div>
          </div>
          
          <div>
            <Typography.Text strong style={{ display: 'block', marginBottom: 8 }}>选择带上的历史版本检测AI味建议</Typography.Text>
            <div className="de-ai-reference-picker" style={{ maxHeight: 200, overflowY: 'auto', border: '1px solid #f0f0f0', borderRadius: 6 }}>
              {versions.filter(v => v.id !== activeVersionId && v.suggestion?.trim()).length > 0 ? (
                <Tree
                  blockNode
                  checkable
                  checkedKeys={selectedHistoricalVersions}
                  onCheck={(checkedKeys) => {
                    const keys = Array.isArray(checkedKeys) ? checkedKeys : checkedKeys.checked;
                    setSelectedHistoricalVersions(keys.map(String));
                  }}
                  selectable={false}
                  treeData={versions.filter(v => v.id !== activeVersionId && v.suggestion?.trim()).map((v) => ({
                    title: \`版本 \${new Date(v.timestamp).toLocaleString()} (AI味: \${v.aiScore ?? '--'})\`,
                    key: v.id,
                  }))}
                />
              ) : (
                <Empty description="暂无可用的历史版本建议" />
              )}
            </div>
          </div>
        </div>
      </Modal>`;

content = content.replace(modalsOldRegex, modalsNew);


// 5. Check if handleRemoverBeforeStart correctly excludes activeVersionId. It does now via `historySuggestions`.
// Wait, in handleRemoverBeforeStart it filters: 
// `v.suggestion?.trim() && v.suggestion.trim() !== confirmedSuggestion.trim() && selectedHistoricalVersions.includes(v.id)`
// We should make it explicitly `v.id !== activeVersionId`.
const handleRemoverOldStr = `    const historySuggestions = latestVersions
      .filter(v => v.suggestion?.trim() && v.suggestion.trim() !== confirmedSuggestion.trim() && selectedHistoricalVersions.includes(v.id))`;
const handleRemoverNewStr = `    const historySuggestions = latestVersions
      .filter(v => v.id !== activeVersionId && v.suggestion?.trim() && v.suggestion.trim() !== confirmedSuggestion.trim() && selectedHistoricalVersions.includes(v.id))`;
content = content.replace(handleRemoverOldStr, handleRemoverNewStr);


// 6. Fix handleRemoverBeforeStart formatting of historical suggestions to include AI Score.
// `recentSuggestionText = historySuggestions.map((v, i) => \`\${i + 1}. 版本 \${new Date(v.timestamp).toLocaleString()}：\\n\${v.suggestion!.trim()}\`).join('\\n\\n');`
const formatOldStr = `\${i + 1}. 版本 \${new Date(v.timestamp).toLocaleString()}：\\n\${v.suggestion!.trim()}\``;
const formatNewStr = `\${i + 1}. 版本 \${new Date(v.timestamp).toLocaleString()} (AI味: \${v.aiScore ?? '--'})：\\n\${v.suggestion!.trim()}\``;
content = content.replace(formatOldStr, formatNewStr);

// 7. Fix the modal display card for Remover Agent to show AI score in the header.
const displayCardOldStr = `<Typography.Text type="secondary" style={{ fontSize: 12 }}>版本 {new Date(v.timestamp).toLocaleString()}</Typography.Text>`;
const displayCardNewStr = `<Typography.Text type="secondary" style={{ fontSize: 12 }}>版本 {new Date(v.timestamp).toLocaleString()} (AI味: {v.aiScore ?? '--'})</Typography.Text>`;
content = content.replace(displayCardOldStr, displayCardNewStr);

fs.writeFileSync(file, content);
console.log('Update complete.');
