import { Children, createElement } from 'react';
import type { ComponentType, HTMLAttributes, ReactElement } from 'react';
import type { SyntaxHighlighterProps } from 'react-syntax-highlighter';
import type { Syntax } from 'refractor/core';
import LightModule from 'react-syntax-highlighter/dist/cjs/prism-light.js';
import tsx from 'refractor/tsx';
import json from 'refractor/json';
import bash from 'refractor/bash';
import markup from 'refractor/markup';
import css from 'refractor/css';
import markdown from 'refractor/markdown';
import yaml from 'refractor/yaml';
import php from 'refractor/php';
import type { CodeBlockProps } from './code.js';
import { codeLanguage } from './code-language.js';

// Normalize Babel's CJS default export for Node and the browser bundler.
type HighlighterComponent = ComponentType<SyntaxHighlighterProps> & {
  registerLanguage: (name: string, grammar: Syntax) => void;
};
const imported = LightModule as unknown as
  HighlighterComponent | { default: HighlighterComponent };
const syntaxHighlighter = 'default' in imported ? imported.default : imported;
for (const grammar of [tsx, json, bash, markup, css, markdown, yaml, php])
  syntaxHighlighter.registerLanguage(grammar.displayName, grammar);

function NumberedCode({ children, ...props }: HTMLAttributes<HTMLElement>) {
  const [gutter, ...source] = Children.toArray(children);
  return (
    <>
      <span className="lab-code-gutter" aria-hidden="true">
        {gutter}
      </span>
      <code {...props}>{source}</code>
    </>
  );
}

export function SyntaxCode({
  code,
  language = 'tsx',
  showLineNumbers = true,
  startingLineNumber = 1,
}: CodeBlockProps): ReactElement {
  const syntax = codeLanguage(language);
  return createElement(syntaxHighlighter, {
    children: code,
    language: syntax === 'plain' ? 'text' : syntax,
    useInlineStyles: false,
    showLineNumbers,
    showInlineLineNumbers: false,
    startingLineNumber,
    lineNumberContainerStyle: {
      float: 'none',
      padding: 0,
      display: 'block',
      font: 'inherit',
      lineHeight: 'inherit',
      whiteSpace: 'pre',
    },
    lineNumberStyle: { color: 'var(--lab-muted)', userSelect: 'none' },
    codeTagProps: { className: 'lab-code-source' },
    CodeTag: showLineNumbers ? NumberedCode : 'code',
    className: 'lab-code',
    tabIndex: 0,
    dir: 'ltr',
    'data-code-language': syntax,
    'data-highlighted': syntax === 'plain' ? 'false' : 'true',
    'data-line-numbers': showLineNumbers ? 'true' : 'false',
    'data-highlighter': 'react-syntax-highlighter',
  });
}
