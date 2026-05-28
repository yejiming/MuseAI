import re

filepath = 'src/pages/Works.tsx'
with open(filepath, 'r') as f:
    content = f.read()

# remove unused variables
content = re.sub(r'\s*const worksDirectory.*?;\n', '\n', content)
content = re.sub(r'\s*const setWorksDirectory.*?;\n', '\n', content)
content = re.sub(r'\s*selectedDirectory,\n', '\n', content)
content = re.sub(r'\s*setSelectedDirectory,\n', '\n', content)
content = re.sub(r'\s*expandedKeys,\n', '\n', content)
content = re.sub(r'\s*setExpandedKeys,\n', '\n', content)

with open(filepath, 'w') as f:
    f.write(content)
