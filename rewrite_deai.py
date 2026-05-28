import re

filepath = 'src/pages/DeAi.tsx'
with open(filepath, 'r') as f:
    content = f.read()

content = content.replace("import DeAiDirectory from '../components/DeAiDirectory';", "import WorkspaceDirectory from '../components/WorkspaceDirectory';")

replacement = """<WorkspaceDirectory 
            title="作品目录" 
            dirType="articles"
            selectedFile={selectedWorkFile}
            onSelectFile={setSelectedWorkFile}
          />"""

content = re.sub(r'<DeAiDirectory title="作品目录" isReference=\{false\} />', replacement, content)

# Also need to add setSelectedWorkFile from useDeAiStore
content = re.sub(r'(selectedWorkFile,\s*\n\s*selectedReferenceFile,)', r'\1\n    setSelectedWorkFile,', content)

# Also change { isReference: true } to { dirType: 'references' } for get_workspace_dir
content = content.replace("'get_de_ai_dir', { isReference: true }", "'get_workspace_dir', { dirType: 'references' }")

with open(filepath, 'w') as f:
    f.write(content)
