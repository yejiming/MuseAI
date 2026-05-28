import re
import os

filepath = 'src/components/WorkspaceDirectory.tsx'
with open(filepath, 'r') as f:
    content = f.read()

# 1. Imports
content = content.replace("import { useDeAiStore } from '../stores/useDeAiStore';", "")
content = content.replace("const ExamplesDirectory: React.FC = () => {", 
"""interface WorkspaceDirectoryProps {
  title: string;
  dirType: 'articles' | 'references' | 'outline';
  selectedFile: string | null;
  onSelectFile: (file: string | null) => void;
}

const WorkspaceDirectory: React.FC<WorkspaceDirectoryProps> = ({ title, dirType, selectedFile, onSelectFile }) => {""")

content = content.replace("export default ExamplesDirectory;", "export default WorkspaceDirectory;")

# 2. Store references
content = re.sub(r"const \{\s*selectedReferenceFile,\s*setSelectedReferenceFile\s*\} = useDeAiStore\(\);", "", content)
content = content.replace("selectedReferenceFile", "selectedFile")
content = content.replace("setSelectedReferenceFile", "onSelectFile")

# 3. Tauri invokes
content = content.replace("'get_de_ai_dir', { isReference: true }", "'get_workspace_dir', { dirType }")
content = content.replace("'import_de_ai_item', { sourcePath, isReference: true }", "'import_workspace_item', { sourcePath, dirType }")
content = content.replace("'delete_de_ai_item'", "'delete_workspace_item'")

# 4. Title
content = content.replace("<strong style={{ color: '#d97757', fontSize: 16 }}>范文目录</strong>", "<strong style={{ color: '#d97757', fontSize: 16 }}>{title}</strong>")

# 5. Conditional Crawl Menu
content = content.replace("{ key: 'crawl', label: '爬取互联网文章', onClick: handleCrawlClick }", 
"  ...(dirType === 'references' ? [{ key: 'crawl', label: '爬取互联网文章', onClick: handleCrawlClick }] : [])")

# 6. Context Menu - Copy Absolute / Relative paths
relative_logic = """
  const copyText = async (text: string) => {
    await navigator.clipboard.writeText(text);
    message.success('已复制路径');
  };

  const relativeToWorkspace = (path: string) => {
    if (!rootDir) return path;
    if (path === rootDir) return '.';
    return path.startsWith(`${rootDir}/`) ? path.slice(rootDir.length + 1) : path;
  };
"""

content = content.replace("const handleLoadData = async ({ key, children }: any) => {", relative_logic + "\n  const handleLoadData = async ({ key, children }: any) => {")

dropdown_replacement = """
                { key: 'cut', label: '剪切' },
                { key: 'copy-absolute', label: '复制绝对路径', onClick: (e) => { e.domEvent.stopPropagation(); void copyText(file.path); } },
                { key: 'copy-relative', label: '复制基于工作空间的相对路径', onClick: (e) => { e.domEvent.stopPropagation(); void copyText(relativeToWorkspace(file.path)); } },
                { key: 'rename', label: '重命名'"""
content = content.replace("{ key: 'cut', label: '剪切' },\n                { key: 'rename', label: '重命名'", dropdown_replacement)

with open(filepath, 'w') as f:
    f.write(content)
