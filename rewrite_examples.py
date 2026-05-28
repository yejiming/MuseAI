import re

filepath = 'src/pages/Examples.tsx'
with open(filepath, 'r') as f:
    content = f.read()

content = content.replace("import ExamplesDirectory from '../components/ExamplesDirectory';", "import WorkspaceDirectory from '../components/WorkspaceDirectory';")

content = content.replace("<ExamplesDirectory />", """<WorkspaceDirectory 
          title="范文目录"
          dirType="references"
          selectedFile={selectedReferenceFile}
          onSelectFile={useDeAiStore.getState().setSelectedReferenceFile}
        />""")

with open(filepath, 'w') as f:
    f.write(content)
