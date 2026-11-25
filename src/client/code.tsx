import { isValidElement, useEffect, useState } from 'react';
import type { HTMLAttributes, ReactNode } from 'react';
import { codeLanguage } from './code-language.js';

export interface CodeBlockProps {
  code: string;
  language?: string;
  showLineNumbers?: boolean;
  startingLineNumber?: number;
}
type Renderer = typeof import('./syntax.js').SyntaxCode;
let ready: Renderer | undefined;
let pending: Promise<Renderer> | undefined;

function loadRenderer() {
  pending ??= import('./syntax.js')
    .then((module) => {
      ready = module.SyntaxCode;
      return ready;
    })
    .catch((error: unknown) => {
      pending = undefined;
      throw error;
    });
  return pending;
}

export function CodeBlock(props: CodeBlockProps) {
  const [Renderer, setRenderer] = useState<Renderer | undefined>(() => ready);
  useEffect(() => {
    let active = true;
    void loadRenderer()
      .then((loaded) => {
        if (active) setRenderer(() => loaded);
      })
      .catch(() => {
        // A failed decorative chunk must not hide or alter the source.
      });
    return () => {
      active = false;
    };
  }, []);
  if (Renderer) return <Renderer {...props} />;
  return (
    <pre
      tabIndex={0}
      className="lab-code"
      dir="ltr"
      data-code-language={codeLanguage(props.language ?? 'tsx')}
      data-highlighted="false"
      data-line-numbers="false"
    >
      <code className="lab-code-source">{props.code}</code>
    </pre>
  );
}

export function MarkdownPre({
  children,
  ...props
}: HTMLAttributes<HTMLPreElement>) {
  if (
    isValidElement<{ children?: ReactNode; className?: string }>(children) &&
    typeof children.props.children === 'string'
  ) {
    const language =
      /(?:^|\s)language-([^\s]+)/.exec(children.props.className ?? '')?.[1] ??
      'plain';
    return <CodeBlock code={children.props.children} language={language} />;
  }
  return (
    <pre {...props} tabIndex={props.tabIndex ?? 0}>
      {children}
    </pre>
  );
}
