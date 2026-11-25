import { useState } from 'react';
import { useLabels } from '../react.js';

import { Inspector } from './inspector.js';
import { CodeBlock } from './code.js';

export function SourcePanel({ source }: { source: string }) {
  const labels = useLabels();
  const [copy, setCopy] = useState<'copied' | 'failed' | ''>('');
  return (
    <Inspector
      active="code"
      tabs={[
        {
          id: 'code',
          title: labels.code,
          content: <CodeBlock code={source} />,
        },
      ]}
      actions={
        <>
          <span role="status">
            {copy === 'copied'
              ? labels.copied
              : copy === 'failed'
                ? labels.copyFailed
                : ''}
          </span>
          <button
            onClick={() => {
              void (async () => {
                try {
                  await navigator.clipboard.writeText(source);
                  setCopy('copied');
                } catch {
                  setCopy('failed');
                }
              })();
            }}
          >
            {labels.copy}
          </button>
        </>
      }
    />
  );
}
