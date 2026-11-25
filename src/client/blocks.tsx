import type { ReactNode } from 'react';
import type { Text } from '../index.js';
import { useLocale, useText } from '../react.js';
import { ApiTable } from './panels.js';
import { Canvas, exampleSource } from './examples.js';
import { useDocumentation } from './definition.js';
import type { RuntimeDocumentation } from './definition.js';
import { asRecord } from '../runtime/data.js';
import { CodeBlock } from './code.js';
export function Title({
  of,
  children,
}: {
  of?: RuntimeDocumentation;
  children?: ReactNode;
}) {
  const locale = useLocale(),
    text = useText();
  return (
    <h1>{children ?? (of ? text(of.title, locale).split('/').pop() : '')}</h1>
  );
}
export function Description({
  of,
  children,
}: {
  of?: RuntimeDocumentation;
  children?: ReactNode;
}) {
  const locale = useLocale(),
    text = useText();
  return (
    <p className="lab-lead">
      {children ?? (of ? text(of.description, locale) : '')}
    </p>
  );
}
export function PropsTable({
  of,
  component,
}: {
  of: RuntimeDocumentation;
  component?: string;
}) {
  const definition = useDocumentation(of);
  return (
    <ApiTable
      props={
        component
          ? (definition.subcomponentApi?.[component] ?? [])
          : (definition.api ?? [])
      }
    />
  );
}
export const ArgsTable = PropsTable;
export function Examples({ of }: { of: RuntimeDocumentation }) {
  return (
    <>
      {Object.keys(of.examples).map((example) => (
        <Canvas key={example} of={of} example={example} />
      ))}
    </>
  );
}
export function Source({
  of,
  example,
  args,
  code,
  language = 'tsx',
  showLineNumbers = true,
  startingLineNumber = 1,
}: {
  of?: RuntimeDocumentation;
  example?: string;
  args?: Record<string, unknown>;
  code?: string;
  language?: string;
  showLineNumbers?: boolean;
  startingLineNumber?: number;
}) {
  const baseArgs = asRecord(of?.args);
  const selected = of
    ? of.examples[example ?? Object.keys(of.examples)[0]]
    : undefined;
  return (
    <CodeBlock
      language={language}
      showLineNumbers={showLineNumbers}
      startingLineNumber={startingLineNumber}
      code={
        code ??
        (of && selected
          ? exampleSource(of, selected, {
              ...baseArgs,
              ...selected.args,
              ...args,
            })
          : '')
      }
    />
  );
}
export function Note({
  children,
  title,
}: {
  children: ReactNode;
  title?: Text;
}) {
  const locale = useLocale(),
    text = useText();
  return (
    <aside className="lab-doc-note">
      {title && <strong>{text(title, locale)}</strong>}
      {children}
    </aside>
  );
}
export function Columns({ children }: { children: ReactNode }) {
  return <div className="lab-doc-columns">{children}</div>;
}
