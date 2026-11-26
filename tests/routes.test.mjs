/**
 * Проверки маршрутов: сохранение старых адресов через aliases,
 * обнаружение дубликатов и неоднозначных идентификаторов.
 * Проверяется доступ к материалам через локальный HTTP-интерфейс MCP:
 * список документов, чтение по каноническим ID и aliases, отказ при неоднозначности.
 * Требует собранный dist/; материалы создаются во временных папках,
 * HTTP-сервер слушает только 127.0.0.1 на свободном порту. Запуск: npm test.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mcpMiddleware } from '../dist/node/mcp.js';
import { discoverContent } from '../dist/node/content.js';
import { resolveRoute } from '../dist/runtime/routes.js';

test('перенос материалов сохраняет старые адреса через явные aliases', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'space-lab-moved-routes-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const config = {
    name: 'Moved',
    version: '1',
    content: ['*'],
    home: 'old--guide',
  };
  await writeFile(
    join(root, 'Guide.mdx'),
    "export const meta = { aliases: ['old--guide'] }\n\n# Guide",
  );
  await writeFile(
    join(root, 'Button.examples.js'),
    "export default { aliases: ['examples:old--button'], examples: { Main: {} } }",
  );
  const entries = await discoverContent(root, config);
  for (const ref of ['guide', 'doc:guide', 'old--guide', 'doc:old--guide'])
    assert.equal(resolveRoute(entries, ref)?.id, 'doc:guide', ref);
  for (const ref of ['old--button', 'examples:old--button'])
    assert.equal(resolveRoute(entries, ref)?.id, 'examples:button', ref);
  await writeFile(
    join(root, 'Other.mdx'),
    "export const meta = { aliases: ['old--guide'] }\n\n# Other",
  );
  await assert.rejects(discoverContent(root, config), /duplicate route alias/);
  await writeFile(
    join(root, 'Other.mdx'),
    "export const meta = { aliases: ['guide'] }\n\n# Other",
  );
  await assert.rejects(discoverContent(root, config), /duplicate route alias/);
  await writeFile(
    join(root, 'Other.mdx'),
    'export const meta = { aliases: [42] }\n\n# Other',
  );
  await assert.rejects(discoverContent(root, config), /invalid aliases/);
});

test('MCP lists canonical routes, resolves unique aliases and rejects ambiguous ones before kind filtering', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'space-lab-routes-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const config = { name: 'Dates', version: '1', content: ['*'] };
  await writeFile(join(root, 'Dates.mdx'), '# Dates');
  await writeFile(
    join(root, 'Dates.examples.tsx'),
    'export default { examples: { Main: {} } }',
  );
  await writeFile(join(root, 'Home.md'), '# Home');
  const server = createServer(mcpMiddleware(root, config));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  async function call(name, id) {
    const response = await fetch(
      `http://127.0.0.1:${server.address().port}/mcp`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name, arguments: { id, example: 'Main' } },
        }),
      },
    );
    return (await response.json()).result;
  }
  assert.deepEqual(
    JSON.parse((await call('list_documents')).content[0].text)
      .map((e) => e.id)
      .sort(),
    ['doc:dates', 'doc:home', 'examples:dates'],
  );
  assert.equal(
    JSON.parse((await call('read_document', 'home')).content[0].text).source,
    '# Home',
  );
  assert.equal(
    JSON.parse((await call('read_document', 'doc:dates')).content[0].text)
      .source,
    '# Dates',
  );
  assert.match(
    JSON.parse((await call('read_document', 'examples:dates')).content[0].text)
      .source,
    /examples:/,
  );
  for (const name of ['read_document', 'get_component_api', 'run_example'])
    assert.equal((await call(name, 'dates')).isError, true, name);
  await writeFile(join(root, 'Dates.examples.js'), 'export default {}');
  await assert.rejects(
    discoverContent(root, config),
    /duplicate page ID: examples:dates.*Dates\.examples\.js\b.*Dates\.examples\.tsx/,
  );
});
