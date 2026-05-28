import re

filepath = 'src/pages/Works.tsx'
with open(filepath, 'r') as f:
    content = f.read()

content = content.replace("import FileExplorer from '../components/FileExplorer';", "import WorkspaceDirectory from '../components/WorkspaceDirectory';")

replacement = """<WorkspaceDirectory
            title="作品目录"
            dirType="articles"
            selectedFile={selectedFile}
            onSelectFile={setSelectedFile}
          />"""

# we need to replace the <FileExplorer ... /> with <WorkspaceDirectory ... />
content = re.sub(r"<FileExplorer[\s\S]*?/>", replacement, content)

# We can also remove unused store bindings like selectedDirectory, etc.
# but it's simpler to just replace the tag.

with open(filepath, 'w') as f:
    f.write(content)
