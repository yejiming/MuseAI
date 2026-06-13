import React, { Suspense } from 'react';
import { Spin } from 'antd';

const MarkdownEditorImpl = React.lazy(() => import('./MarkdownEditorImpl'));

interface MarkdownEditorProps {
  filePath: string | null;
  readOnly?: boolean;
}

const MarkdownEditor: React.FC<MarkdownEditorProps> = (props) => (
  <Suspense
    fallback={(
      <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Spin />
      </div>
    )}
  >
    <MarkdownEditorImpl {...props} />
  </Suspense>
);

export default MarkdownEditor;
