import React, { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Tree, Dropdown, MenuProps, message, Modal, Form, Select, Input, Button } from 'antd';
import { open } from '@tauri-apps/plugin-dialog';
import { DownOutlined } from '@ant-design/icons';


interface FileNode {
  name: string;
  path: string;
  is_dir: boolean;
  children?: FileNode[];
}

interface WorkspaceDirectoryProps {
  title: string;
  dirType: 'articles' | 'references' | 'outline';
  selectedFile: string | null;
  onSelectFile: (file: string | null) => void;
}

const WorkspaceDirectory: React.FC<WorkspaceDirectoryProps> = ({ title, dirType, selectedFile, onSelectFile }) => {
  const [nodes, setNodes] = useState<FileNode[]>([]);
  const [rootDir, setRootDir] = useState<string>('');
  const [expandedKeys, setExpandedKeys] = useState<React.Key[]>([]);
  const [cutPath, setCutPath] = useState<string | null>(null);
  
  const [isCrawlModalOpen, setIsCrawlModalOpen] = useState(false);
  const [isCrawling, setIsCrawling] = useState(false);
  const [crawlTargetDir, setCrawlTargetDir] = useState<string>('');
  const [renamingKey, setRenamingKey] = useState<string | null>(null);
  const [form] = Form.useForm();
  
  

  const parentPathOf = (path: string) => path.replace(/[\\/][^\\/]*$/, '');

  const joinPath = (dir: string, name: string) => `${dir}/${name}`;

  const isInsidePath = (path: string, parent: string) => {
    const normalizedPath = path.replace(/\\/g, '/');
    const normalizedParent = parent.replace(/\\/g, '/');
    return normalizedPath === normalizedParent || normalizedPath.startsWith(`${normalizedParent}/`);
  };

  const replacePathPrefix = (path: string, oldPrefix: string, newPrefix: string) => {
    if (path === oldPrefix) return newPrefix;
    if (path.startsWith(`${oldPrefix}/`) || path.startsWith(`${oldPrefix}\\`)) {
      return `${newPrefix}${path.slice(oldPrefix.length)}`;
    }
    return path;
  };

  const loadFiles = async (keys: React.Key[] = expandedKeys) => {
    try {
      const referenceRootDir: string = await invoke('get_workspace_dir', { dirType });
      setRootDir(referenceRootDir);
      const rootItems: FileNode[] = await invoke('list_dir', { path: referenceRootDir });
      
      const fetchChildren = async (items: FileNode[]): Promise<FileNode[]> => {
        return Promise.all(items.map(async item => {
          if (item.is_dir && keys.includes(item.path)) {
            try {
              const children = await invoke<FileNode[]>('list_dir', { path: item.path });
              item.children = await fetchChildren(children.filter(i => i.name !== '.versions'));
            } catch (e) {
              item.children = [];
            }
          }
          return item;
        }));
      };
      
      const newNodes = await fetchChildren(rootItems.filter(i => i.name !== '.versions'));
      setNodes(newNodes);
    } catch (e) {
      console.error(e);
      message.error('加载文件失败');
    }
  };

  useEffect(() => {
    loadFiles();
  }, [expandedKeys]);

  const getRootDir = async () => {
    const referenceRootDir = await invoke<string>('get_workspace_dir', { dirType });
    setRootDir(referenceRootDir);
    return referenceRootDir;
  };

  const handleCrawlClick = async () => {
    const dir = await getRootDir();
    setCrawlTargetDir(dir);
    form.resetFields();
    form.setFieldsValue({ type: '番茄小说-长篇' });
    setIsCrawlModalOpen(true);
  };

  const handleCrawlSubmit = async (values: any) => {
    setIsCrawling(true);
    try {
      const msg: string = await invoke('crawl_fanqie_article', {
        url: values.url,
        novelType: values.type,
        targetDir: crawlTargetDir,
      });
      message.success(msg);
      setIsCrawlModalOpen(false);
      loadFiles();
    } catch (e) {
      console.error(e);
      message.error(`爬取失败: ${e}`);
    } finally {
      setIsCrawling(false);
    }
  };

  const handleImport = async (type: 'file' | 'folder') => {
    try {
      const isDirectory = type === 'folder';
      const selected = await open({
        directory: isDirectory,
        multiple: false,
        filters: isDirectory ? undefined : [{ name: '文档和图片', extensions: ['md', 'txt', 'png', 'jpg', 'jpeg'] }],
      });
      
      if (!selected) return;

      const sourcePath = typeof selected === 'string' ? selected : selected[0];
      const targetDir = await getRootDir();

      if (isDirectory) {
        await invoke('import_local_folder_shallow', { source: sourcePath, targetDir });
      } else {
        await invoke('import_workspace_item', { sourcePath, dirType });
        const root = await invoke<string>('get_workspace_dir', { dirType });
        if (targetDir !== root) {
            const fileName = sourcePath.split(/[\\/]/).pop();
            if (fileName) {
                 await invoke('move_item', { source: `${root}/${fileName}`, targetDir });
            }
        }
      }
      
      message.success('导入成功');
      loadFiles();
    } catch (e) {
      console.error(e);
      message.error(`导入失败: ${e}`);
    }
  };

  const handleDelete = (path: string) => {
    Modal.confirm({
      title: '确认删除',
      content: '确定要删除该文件/文件夹吗？',
      onOk: async () => {
        try {
          await invoke('delete_workspace_item', { itemPath: path });
          if (selectedFile === path) {
            onSelectFile(null);
          }
          message.success('删除成功');
          loadFiles();
        } catch (e) {
          message.error(`删除失败: ${e}`);
        }
      }
    });
  };

  const handleRenameSubmit = async (path: string, oldName: string, newNameStr: string) => {
    setRenamingKey(null);
    if (!newNameStr || newNameStr === oldName) return;
    try {
      await invoke('rename_item', { path, newName: newNameStr });
      if (selectedFile === path) {
         const parts = path.split(/[\\/]/);
         parts.pop();
         onSelectFile(parts.join('/') + '/' + newNameStr);
      }
      message.success('重命名成功');
      loadFiles();
    } catch (e) {
      message.error(`重命名失败: ${e}`);
    }
  };

  const updateTreeData = (list: FileNode[], key: React.Key, children: FileNode[]): FileNode[] =>
    list.map((node) => {
      if (node.path === key) {
        return {
          ...node,
          children,
        };
      }
      if (node.children) {
        return {
          ...node,
          children: updateTreeData(node.children, key, children),
        };
      }
      return node;
    });

  
  const copyText = async (text: string) => {
    await navigator.clipboard.writeText(text);
    message.success('已复制路径');
  };

  const relativeToWorkspace = (path: string) => {
    if (!rootDir) return path;
    if (path === rootDir) return '.';
    return path.startsWith(`${rootDir}/`) ? path.slice(rootDir.length + 1) : path;
  };

  const handleLoadData = async ({ key, children }: any) => {
    if (children && children.length > 0) {
      return;
    }
    const items: FileNode[] = await invoke('list_dir', { path: key });
    setNodes((origin) => updateTreeData(origin, key, items.filter(item => item.name !== '.versions')));
  };

  const moveItemToDirectory = async (sourcePath: string, targetDir: string) => {
    try {
      if (isInsidePath(targetDir, sourcePath)) {
        message.error('无法移动到该目标位置');
        return;
      }
      
      const sourceDir = parentPathOf(sourcePath);
      
      if (sourceDir === targetDir) {
        message.warning('文件已在目标目录，取消移动');
        return;
      }

      await invoke('move_item', { source: sourcePath, targetDir });
      const movedName = sourcePath.split(/[\\/]/).pop();
      const nextPath = movedName ? joinPath(targetDir, movedName) : sourcePath;
      if (selectedFile && isInsidePath(selectedFile, sourcePath)) {
        onSelectFile(replacePathPrefix(selectedFile, sourcePath, nextPath));
      }
      setCutPath(null);
      const nextExpandedKeys = expandedKeys.includes(targetDir) ? expandedKeys : [...expandedKeys, targetDir];
      setExpandedKeys(nextExpandedKeys);
      message.success('移动成功');
      await loadFiles(nextExpandedKeys);
    } catch (e) {
      message.error(`移动失败: ${e}`);
    }
  };

  const canPasteTo = (targetDir: string) => {
    if (!cutPath) return false;
    return parentPathOf(cutPath) !== targetDir && !isInsidePath(targetDir, cutPath);
  };

  const mapToTreeData = (files: FileNode[]): any[] => {
    return files.map(file => {
      const isRenaming = renamingKey === file.path;
      return {
        title: isRenaming ? (
          <Input 
            autoFocus
            defaultValue={file.name}
            size="small"
            onClick={(e) => e.stopPropagation()}
            onBlur={(e) => handleRenameSubmit(file.path, file.name, e.target.value)}
            onPressEnter={(e) => handleRenameSubmit(file.path, file.name, (e.target as any).value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setRenamingKey(null);
                e.stopPropagation();
              }
            }}
          />
        ) : (
          <Dropdown
            menu={{
              items: [
                ...(file.is_dir ? [
                  { key: 'new_file', label: '新建文件' },
                  { key: 'new_folder', label: '新建文件夹' },
                  ...(cutPath && canPasteTo(file.path) ? [
                    { key: 'paste', label: '粘贴到此处' },
                  ] : []),
                  { type: 'divider' as const },
                ] : []),
                
                { key: 'cut', label: '剪切' },
                { key: 'copy-absolute', label: '复制绝对路径', onClick: (e) => { e.domEvent.stopPropagation(); void copyText(file.path); } },
                { key: 'copy-relative', label: '复制基于工作空间的相对路径', onClick: (e) => { e.domEvent.stopPropagation(); void copyText(relativeToWorkspace(file.path)); } },
                { key: 'rename', label: '重命名', onClick: (e) => { e.domEvent.stopPropagation(); setRenamingKey(file.path); } },
                { key: 'delete', label: '删除', danger: true, onClick: (e) => { e.domEvent.stopPropagation(); handleDelete(file.path); } }
              ],
              onClick: ({ key, domEvent }) => {
                domEvent.stopPropagation();
                if (key === 'new_file') {
                  void handleCreateItem('file', file.path);
                }
                if (key === 'new_folder') {
                  void handleCreateItem('folder', file.path);
                }
                if (key === 'paste' && cutPath) {
                  void moveItemToDirectory(cutPath, file.path);
                }
                if (key === 'cut') {
                  setCutPath(file.path);
                  message.success('已剪切，右键目标文件夹或空白处粘贴');
                }
              },
            }}
            trigger={['contextMenu']}
          >
            <div
              onContextMenu={(event) => event.stopPropagation()}
              style={{
                width: '100%',
                opacity: cutPath === file.path ? 0.55 : 1,
              }}
            >
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {file.name}
              </span>
            </div>
          </Dropdown>
        ),
        key: file.path,
        name: file.name,
        path: file.path,
        isDir: file.is_dir,
        isLeaf: !file.is_dir,
        children: file.children ? mapToTreeData(file.children) : undefined,
      };
    });
  };

  const handleCreateItem = async (type: 'file' | 'folder', explicitTargetDir?: string) => {
    const targetDir = explicitTargetDir ?? await getRootDir();
    try {
      const newName: string = await invoke('create_untitled_item', { targetDir, isDir: type === 'folder' });
      const nextExpandedKeys = expandedKeys.includes(targetDir) ? expandedKeys : [...expandedKeys, targetDir];
      setExpandedKeys(nextExpandedKeys);
      await loadFiles(nextExpandedKeys);
      const newPath = `${targetDir}/${newName}`;
      setTimeout(() => setRenamingKey(newPath), 100);
    } catch (e) {
      message.error(`创建失败: ${e}`);
    }
  };

  const menuProps: MenuProps = {
    items: [
      { key: 'new_file', label: '新建文件', onClick: () => handleCreateItem('file') },
      { key: 'new_folder', label: '新建文件夹', onClick: () => handleCreateItem('folder') },
      { type: 'divider' },
      { key: 'file', label: '导入本地文件', onClick: () => handleImport('file') },
      { key: 'folder', label: '导入本地文件夹', onClick: () => handleImport('folder') },
        ...(dirType === 'references' ? [{ key: 'crawl', label: '爬取互联网文章', onClick: handleCrawlClick }] : [])
    ],
  };

  const rootContextMenuProps: MenuProps = {
    items: [
      { key: 'new_file', label: '新建文件' },
      { key: 'new_folder', label: '新建文件夹' },
      ...(cutPath && canPasteTo(rootDir) ? [
        { type: 'divider' as const },
        { key: 'paste', label: '粘贴到根目录' },
      ] : []),
    ],
    onClick: ({ key, domEvent }) => {
      domEvent.stopPropagation();
      if (!rootDir) return;
      if (key === 'new_file') {
        void handleCreateItem('file', rootDir);
      }
      if (key === 'new_folder') {
        void handleCreateItem('folder', rootDir);
      }
      if (key === 'paste' && cutPath) {
        void moveItemToDirectory(cutPath, rootDir);
      }
    },
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: '16px' }}>
      <Modal
        title="爬取互联网文章"
        open={isCrawlModalOpen}
        onCancel={() => setIsCrawlModalOpen(false)}
        footer={null}
        destroyOnClose
      >
        <Form form={form} layout="vertical" onFinish={handleCrawlSubmit}>
          <Form.Item 
            name="type" 
            label="小说类型" 
            rules={[{ required: true, message: '请选择类型' }]}
          >
            <Select>
              <Select.Option value="番茄小说-长篇">番茄小说-长篇</Select.Option>
              <Select.Option value="番茄小说-短篇">番茄小说-短篇</Select.Option>
            </Select>
          </Form.Item>
          
          <Form.Item 
            name="url" 
            label="小说主页链接 (URL)" 
            rules={[{ required: true, message: '请输入链接' }, { type: 'url', message: '请输入有效的网址' }]}
          >
            <Input placeholder="例如: https://fanqienovel.com/page/7097114126693960704" />
          </Form.Item>
          
          <Form.Item>
            <Button type="primary" htmlType="submit" loading={isCrawling} block>
              开始爬取
            </Button>
          </Form.Item>
        </Form>
      </Modal>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <strong style={{ color: '#d97757', fontSize: 16 }}>{title}</strong>
        <Dropdown menu={menuProps} trigger={['click']}>
          <a onClick={(e) => e.preventDefault()} style={{ cursor: 'pointer', color: '#d97757', fontWeight: 500 }}>
            添加 <DownOutlined style={{ fontSize: 12 }} />
          </a>
        </Dropdown>
      </div>
      <Dropdown menu={rootContextMenuProps} trigger={['contextMenu']}>
        <div
          style={{ flex: 1, overflowY: 'auto' }}
        >
          {nodes.length > 0 ? (
            <Tree
              treeData={mapToTreeData(nodes)}
              loadData={handleLoadData}
              selectedKeys={selectedFile ? [selectedFile] : []}
              expandedKeys={expandedKeys}
              onExpand={(keys) => setExpandedKeys([...keys])}
              onSelect={(selectedKeys, info) => {
                const key = info.node.key as string;
                if (info.node.isLeaf && selectedKeys.length > 0) {
                  onSelectFile(key);
                } else {
                  setExpandedKeys((keys) =>
                    keys.includes(key) ? keys.filter((item) => item !== key) : [...keys, key]
                  );
                }
              }}
              blockNode
              style={{ background: 'transparent' }}
            />
          ) : (
            <div style={{ color: '#999', textAlign: 'center', marginTop: 40, fontSize: 14 }}>
              目录为空，请导入文件或爬取文章
            </div>
          )}
        </div>
      </Dropdown>
    </div>
  );
};

export default WorkspaceDirectory;
