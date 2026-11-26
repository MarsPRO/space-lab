/**
 * Проверки команды space-lab init: создание конфигурации из шаблона,
 * повторный и одновременный запуск, сохранность существующих файлов,
 * обработка неверных аргументов и конфликта с каталогом.
 * CLI запускается в отдельных процессах во временных проектах.
 * Требует собранный dist/ и templates/; запускается через npm test.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';

const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
const template = new URL('../templates/space-lab.config.mjs', import.meta.url);

async function project(t) {
  const root = await mkdtemp(join(tmpdir(), 'space-lab-init-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

function run(root, ...args) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd: root,
    encoding: 'utf8',
    timeout: 15_000,
  });
}

test('init creates the shipped configuration in the current project and supports a repeat run', async (t) => {
  const root = await project(t);
  const result = run(root, 'init');
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.includes(join(root, 'space-lab.config.mjs')));
  assert.match(result.stdout, /Next:/);
  const expected = await readFile(template, 'utf8');
  assert.equal(
    await readFile(join(root, 'space-lab.config.mjs'), 'utf8'),
    expected,
  );
  assert.match(expected, /from '@marspro\/space-lab'/);
  const repeat = run(root, 'init');
  assert.equal(repeat.status, 0, repeat.stderr);
  assert.match(repeat.stdout, /already exists; left unchanged/);
  assert.equal(
    await readFile(join(root, 'space-lab.config.mjs'), 'utf8'),
    expected,
  );
});

test('init preserves an existing configuration and does not execute it or edit package.json', async (t) => {
  const root = await project(t);
  const config = "throw new Error('Must not execute');\n";
  const manifest = '{"name":"my-project","private":true}\n';
  await writeFile(join(root, 'space-lab.config.mjs'), config);
  await writeFile(join(root, 'package.json'), manifest);
  const result = run(root, 'init');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /left unchanged/);
  assert.equal(
    await readFile(join(root, 'space-lab.config.mjs'), 'utf8'),
    config,
  );
  assert.equal(await readFile(join(root, 'package.json'), 'utf8'), manifest);
});

test('init rejects unsupported arguments before creating files', async (t) => {
  const root = await project(t);
  for (const args of [['--force'], ['other-project']]) {
    const result = run(root, 'init', ...args);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Usage: space-lab init/);
    await assert.rejects(readFile(join(root, 'space-lab.config.mjs')), {
      code: 'ENOENT',
    });
  }
  const help = run(root, '--help');
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /space-lab init/);
});

test('init reports a conflicting directory without changing its contents', async (t) => {
  const root = await project(t);
  const target = join(root, 'space-lab.config.mjs');
  await mkdir(target);
  await writeFile(join(target, 'keep.txt'), 'keep');
  const result = run(root, 'init');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Space Lab:/);
  assert.equal(await readFile(join(target, 'keep.txt'), 'utf8'), 'keep');
});

test('concurrent init calls create one complete configuration without overwriting it', async (t) => {
  const root = await project(t);
  const start = () =>
    new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [cli, 'init'], {
        cwd: root,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '',
        stderr = '';
      child.stdout.on('data', (chunk) => {
        stdout += chunk;
      });
      child.stderr.on('data', (chunk) => {
        stderr += chunk;
      });
      child.on('error', reject);
      child.on('close', (status) => resolve({ status, stdout, stderr }));
    });
  const results = await Promise.all([start(), start()]);
  for (const result of results) assert.equal(result.status, 0, result.stderr);
  assert.equal(
    results.filter((result) => result.stdout.startsWith('Created ')).length,
    1,
  );
  assert.equal(
    results.filter((result) => result.stdout.includes('left unchanged')).length,
    1,
  );
  assert.equal(
    await readFile(join(root, 'space-lab.config.mjs'), 'utf8'),
    await readFile(template, 'utf8'),
  );
});
