/**
 * Проверки runtime: снимки событий и spy, безопасная сериализация,
 * передача аргументов через URL, пауза/продолжение/ошибки сценариев.
 * Также проверяется извлечение API из TypeScript без исполнения кода,
 * включая подкомпоненты и сторонние декларации типов.
 * Требует собранный dist/; тестовые компоненты создаются во временных папках.
 * Запуск: npm test. Собственные docs/ и examples/ проекта не используются.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  action,
  getActions,
  clearActions,
  serializable,
} from '../dist/runtime/actions.js';
import { ScenarioRunner } from '../dist/runtime/scenario.js';
import { argsFromUrl, argsToUrl, objectValue } from '../dist/runtime/url.js';
import { extractApi } from '../dist/node/docgen.js';

test('события сохраняют снимок аргументов и результат spy, циклы и события сериализуются безопасно', () => {
  clearActions();
  const listener = action('changed', (value) => value.count + 1),
    value = { count: 2 };
  assert.equal(listener(value), 3);
  value.count = 10;
  assert.equal(listener.calls.length, 1);
  assert.deepEqual(getActions()[0].args, [{ count: 2 }]);
  const cycle = {};
  cycle.self = cycle;
  assert.deepEqual(serializable(cycle), { self: '[Circular]' });
  listener.clear();
  assert.equal(listener.calls.length, 0);
  clearActions();
  assert.equal(getActions().length, 0);
});
test('аргументы переживают URL, не переносятся на другой пример и не сериализуют callbacks', () => {
  const raw = argsToUrl('page', 'Main', {
    count: 4,
    label: '<text>',
    callback() {},
  });
  const state = new URLSearchParams({ args: raw });
  assert.deepEqual(argsFromUrl(state, 'page', 'Main'), {
    count: 4,
    label: '<text>',
  });
  assert.deepEqual(argsFromUrl(state, 'page', 'Other'), {});
  const entries = [{ id: 'examples:page' }];
  assert.deepEqual(argsFromUrl(state, 'examples:page', 'Main', entries), {
    count: 4,
    label: '<text>',
  });
  assert.deepEqual(
    argsFromUrl(state, 'examples:page', 'Main', [
      ...entries,
      { id: 'doc:page' },
    ]),
    {},
  );
  assert.deepEqual(objectValue('{broken'), {});
  assert.deepEqual(
    objectValue('{"__proto__":{"x":true},"density":"compact"}'),
    { density: 'compact' },
  );
});
const context = {
  locale: 'en',
  theme: 'light',
  globals: {},
  loaded: {},
  args: {},
  canvasElement: {},
};
test('сценарий пошагово приостанавливается, продолжается и показывает реальные ошибки', async () => {
  const runner = new ScenarioRunner(),
    calls = [];
  const running = runner.run(
    async ({ step }) => {
      await step('first', () => calls.push(1));
      await step('second', () => calls.push(2));
    },
    context,
    true,
  );
  assert.equal(runner.getSnapshot().status, 'paused');
  assert.deepEqual(calls, []);
  runner.next();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(calls, [1]);
  assert.equal(runner.getSnapshot().status, 'paused');
  runner.resume();
  await running;
  assert.equal(runner.getSnapshot().status, 'passed');
  assert.deepEqual(calls, [1, 2]);
  await runner.run(
    async ({ step }) =>
      step('failure', () => {
        throw new Error('Expected failure');
      }),
    context,
  );
  assert.equal(runner.getSnapshot().status, 'failed');
  assert.match(runner.getSnapshot().error, /Expected failure/);
  const stopped = runner.run(
    async ({ step }) => step('never', () => calls.push(3)),
    context,
    true,
  );
  runner.stop();
  await stopped;
  assert.equal(runner.getSnapshot().status, 'stopped');
  assert.deepEqual(calls, [1, 2]);
});
test('API извлекается из импортированного TypeScript-компонента без исполнения, callback не становится JSON control', async () => {
  const root = await mkdtemp(join(tmpdir(), 'space-lab-api-'));
  await writeFile(
    join(root, 'Button.tsx'),
    `throw new Error('No execution'); interface Props { /** Visible label */ label: string; count?: number; tone: 'primary' | 'quiet'; onChange?: (value: number) => void; } export function Button({label,count=3}:Props){return null;}`,
  );
  await writeFile(
    join(root, 'Button.examples.tsx'),
    `import {Button} from './Button'; export default defineExamples({component:Button,title:'Components/Button',args:{label:'Save'},examples:{Main:{}}});`,
  );
  const props = extractApi(root, ['Button.examples.tsx']).get(
    join(root, 'Button.examples.tsx').replaceAll('\\', '/'),
  );
  assert.equal(props.find((prop) => prop.name === 'label').required, true);
  assert.equal(props.find((prop) => prop.name === 'count').defaultValue, '3');
  assert.equal(props.find((prop) => prop.name === 'count').required, false);
  assert.deepEqual(props.find((prop) => prop.name === 'tone').control.options, [
    'primary',
    'quiet',
  ]);
  assert.equal(
    props.find((prop) => prop.name === 'onChange').control,
    undefined,
  );
});
test('подкомпоненты и сторонние декларации входят в API основного экспорта', async () => {
  const root = await mkdtemp(join(tmpdir(), 'space-lab-composed-'));
  await mkdir(join(root, 'node_modules/sample-ui'), { recursive: true });
  await writeFile(
    join(root, 'node_modules/sample-ui/package.json'),
    '{"name":"sample-ui","types":"index.d.ts"}',
  );
  await writeFile(
    join(root, 'node_modules/sample-ui/index.d.ts'),
    `export declare function Button(props:{/** Library label */ label:string}):any;`,
  );
  await writeFile(
    join(root, 'Button.examples.tsx'),
    `import {Button} from 'sample-ui'; function Badge(props:{text:string,size?:number}){return null;} const meta={component:Button,subcomponents:{Badge},args:{label:'Save'},examples:{Main:{}}}; export default defineExamples(meta); const unrelated={component:Badge};`,
  );
  const output = extractApi(root, ['Button.examples.tsx']),
    name = join(root, 'Button.examples.tsx').replaceAll('\\', '/');
  assert.equal(output.get(name)[0].name, 'label');
  assert.deepEqual(
    output.get(name + '#Badge').map((prop) => prop.name),
    ['text', 'size'],
  );
});
