import assert from 'node:assert/strict';
import { spawnSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, firefox, webkit } from 'playwright';

const root = fileURLToPath(new URL('..', import.meta.url));
const flags = {};
const known = new Set([
  'node',
  'npm',
  'react',
  'types-react',
  'types-dom',
  'typescript',
  'browsers',
  'archive',
  'resume',
  'playwright',
]);
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i].replace(/^--/, '');
  if (!known.has(key) || !process.argv[i + 1])
    throw new Error(`Unknown or missing option: ${process.argv[i]}`);
  flags[key] = process.argv[i + 1];
}
const node = resolve(flags.node ?? process.execPath);
const npm = resolve(
  flags.npm ?? resolve(dirname(node), 'node_modules/npm/bin/npm-cli.js'),
);
const browsers = (flags.browsers ?? 'chrome').split(',');
assert.ok(
  browsers.every((name) => ['chrome', 'firefox', 'webkit'].includes(name)),
);
const scratch = flags.resume
  ? resolve(flags.resume)
  : await mkdtemp(resolve(tmpdir(), 'space-lab-support-'));
const consumer = resolve(scratch, 'consumer');
await mkdir(resolve(consumer, 'vendor'), { recursive: true });
console.log(`Support evidence: ${scratch}`);
const env = {
  ...process.env,
  CI: '1',
  PATH: dirname(node) + delimiter + process.env.PATH,
};
const report = flags.resume
  ? JSON.parse(await readFile(resolve(scratch, 'report.json'), 'utf8'))
  : {
      platform: process.platform,
      architecture: process.arch,
      commands: [],
      browsers: [],
    };
if (flags.resume) {
  report.previousAttempts = [
    ...(report.previousAttempts ?? []),
    { status: report.status, error: report.error },
  ];
  report.browsers = [];
  delete report.error;
}
async function save() {
  await writeFile(
    resolve(scratch, 'report.json'),
    JSON.stringify(report, null, 2),
  );
}
function run(file, args, cwd = consumer) {
  const result = spawnSync(node, [file, ...args], {
    cwd,
    env,
    encoding: 'utf8',
    timeout: 240_000,
    maxBuffer: 16 * 1024 * 1024,
  });
  report.commands.push({
    command: [file, ...args].join(' '),
    exit: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    error: result.error?.message,
  });
  assert.equal(
    result.status,
    0,
    `${file} ${args.join(' ')}\n${result.error ?? ''}\n${result.stdout}\n${result.stderr}`,
  );
  return result.stdout;
}
const hash = async (file) =>
  createHash('sha256')
    .update(await readFile(file))
    .digest('hex');
const cli = resolve(consumer, 'node_modules/space-lab/dist/cli.js');
try {
  if (!flags.resume) {
    report.node = run('-p', ['process.version']).trim();
    report.npm = run(npm, ['--version']).trim();
    let archive = flags.archive ? resolve(flags.archive) : undefined;
    if (!archive) {
      const packed = JSON.parse(
        run(npm, ['pack', '--json', '--pack-destination', scratch], root),
      )[0];
      archive = resolve(scratch, packed.filename);
    }
    report.archiveSha256 = await hash(archive);
    await copyFile(archive, resolve(consumer, 'vendor/engine.tgz'));
    const dependencies = {
      'space-lab': 'file:vendor/engine.tgz',
      react: flags.react ?? '18.3.1',
      'react-dom': flags.react ?? '18.3.1',
      '@types/react': flags['types-react'] ?? '18.3.28',
      '@types/react-dom': flags['types-dom'] ?? '18.3.7',
      '@types/node': '22.10.2',
      typescript: flags.typescript ?? '5.9.3',
      playwright: flags.playwright ?? '1.65.1',
    };
    report.requested = dependencies;
    await writeFile(
      resolve(consumer, 'package.json'),
      JSON.stringify({
        private: true,
        type: 'module',
        devDependencies: dependencies,
      }),
    );
    run(npm, ['install', '--no-audit', '--no-fund']);
    run(npm, ['ci', '--no-audit', '--no-fund']);
    report.installed = {};
    for (const name of Object.keys(dependencies)) {
      report.installed[name] = JSON.parse(
        await readFile(
          resolve(consumer, 'node_modules', name, 'package.json'),
          'utf8',
        ),
      ).version;
    }
    await mkdir(resolve(consumer, 'docs'));
    await copyFile(
      resolve(root, 'tests/fixtures/api-compat/legacy.mts'),
      resolve(consumer, 'legacy.mts'),
    );
    await copyFile(
      resolve(root, 'tests/fixtures/api-compat/runtime.mjs'),
      resolve(consumer, 'runtime.mjs'),
    );
    await writeFile(
      resolve(consumer, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          strict: true,
          noEmit: true,
          skipLibCheck: false,
          target: 'ES2022',
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          types: ['node', 'react'],
        },
        files: ['legacy.mts'],
      }),
    );
    run(resolve(consumer, 'node_modules/typescript/bin/tsc'), [
      '-p',
      'tsconfig.json',
    ]);
    run(resolve(consumer, 'runtime.mjs'), []);
    await writeFile(
      resolve(consumer, 'docs/Guide.mdx'),
      `export const meta={title:'Guide',keywords:['supportneedle']}\n\n# Support guide\n\nUnique supportneedle content.\n\n[Next](./Next.md)\n`,
    );
    await writeFile(
      resolve(consumer, 'docs/Next.md'),
      '# Next guide\n\nSecond document.',
    );
    await writeFile(
      resolve(consumer, 'docs/React.examples.jsx'),
      `import {useState} from 'react';import {defineExamples} from 'space-lab';function Button({label}){const[n,set]=useState(0);return <button id="react-probe" onClick={()=>set(n+1)}>{label} {n}</button>}export default defineExamples({title:'React',component:Button,args:{label:'React fixture'},source:'<button>React fixture</button>',examples:{Default:{play:async({canvasElement,step})=>{await step('mounted',()=>{if(!canvasElement.querySelector('button'))throw new Error('React not mounted')})}}}});`,
    );
    await writeFile(
      resolve(consumer, 'docs/Native.examples.js'),
      `import {defineExamples,domRenderer} from 'space-lab';export default defineExamples({title:'Native',args:{label:'Native fixture'},source:'<button>Native fixture</button>',renderer:domRenderer((element,args)=>{const b=document.createElement('button');let n=0;b.id='native-probe';b.textContent=args.label+' '+n;b.onclick=()=>{b.textContent=args.label+' '+(++n)};element.append(b);return()=>b.remove()}),examples:{Default:{play:async({canvasElement,step})=>{await step('mounted',()=>{if(!canvasElement.querySelector('button'))throw new Error('Native not mounted')})}}}});`,
    );
    const config = (base) =>
      `import{defineConfig}from'space-lab';export default defineConfig({name:'Support fixture',version:'fixture',content:['docs/**/*.{md,mdx,jsx,js}'],home:'doc:docs--guide',defaultLocale:'en'${base ? `,base:'${base}'` : ''}});`;
    assert.equal(run(cli, ['--version']).trim(), report.installed['space-lab']);
    for (const [base, output] of [
      ['', 'site-root'],
      ['/nested/', 'site-nested'],
    ]) {
      await writeFile(resolve(consumer, 'space-lab.config.mjs'), config(base));
      run(cli, ['build', '--output-dir', output]);
      const index = JSON.parse(
        await readFile(resolve(consumer, output, 'index.json'), 'utf8'),
      );
      assert.equal(index.length, 4);
      if (base)
        assert.ok(
          (
            await readFile(resolve(consumer, output, 'index.html'), 'utf8')
          ).includes('/nested/assets/'),
        );
    }
    // The built-in capture runner deliberately uses installed Google Chrome.
    report.cliInteractions = run(cli, [
      'test',
      '--interactions',
      '--locale',
      'en',
    ]);
    assert.match(report.cliInteractions, /2\/2 passed/);
  } else {
    assert.equal(run('-p', ['process.version']).trim(), report.node);
    assert.equal(
      await hash(resolve(consumer, 'vendor/engine.tgz')),
      report.archiveSha256,
    );
  }
  const reservation = createServer();
  await new Promise((done) => reservation.listen(0, '127.0.0.1', done));
  const port = reservation.address().port;
  await new Promise((done) => reservation.close(done));
  const dev = spawn(node, [cli, 'dev', '--port', String(port)], {
    cwd: consumer,
    env,
    stdio: 'pipe',
  });
  let serverLog = '';
  dev.stdout.on('data', (data) => {
    serverLog += data;
  });
  dev.stderr.on('data', (data) => {
    serverLog += data;
  });
  const staticServer = createServer(async (request, response) => {
    try {
      const path = decodeURIComponent(
        new URL(request.url, 'http://localhost').pathname,
      );
      const prefix = path.startsWith('/nested/') ? '/nested/' : '/';
      const base = resolve(
        consumer,
        prefix === '/nested/' ? 'site-nested' : 'site-root',
      );
      const file = resolve(base, path.slice(prefix.length) || 'index.html');
      assert.ok(file.startsWith(base + sep));
      response.setHeader(
        'Content-Type',
        {
          '.js': 'text/javascript',
          '.css': 'text/css',
          '.json': 'application/json',
          '.html': 'text/html',
        }[extname(file)] ?? 'application/octet-stream',
      );
      response.end(await readFile(file));
    } catch {
      response.writeHead(404).end();
    }
  });
  try {
    let ready = false;
    for (let i = 0; i < 600 && dev.exitCode === null; i++) {
      try {
        ready = (await fetch(`http://127.0.0.1:${port}/index.json`)).ok;
      } catch {
        /* Startup connection refusal. */
      }
      if (ready) break;
      await new Promise((done) => setTimeout(done, 100));
    }
    assert.ok(ready, serverLog);
    await new Promise((done) => staticServer.listen(0, '127.0.0.1', done));
    const devUrl = `http://127.0.0.1:${port}/nested/`;
    const staticUrl = `http://127.0.0.1:${staticServer.address().port}`;
    for (const name of browsers) {
      const browser = await { chrome: chromium, firefox, webkit }[name].launch({
        ...(name === 'chrome' ? { channel: 'chrome' } : {}),
        headless: true,
      });
      const result = { name, version: browser.version(), journeys: [] };
      report.browsers.push(result);
      try {
        const context = await browser.newContext({
          ...(name === 'chrome'
            ? { permissions: ['clipboard-read', 'clipboard-write'] }
            : {}),
          viewport: { width: 1440, height: 1000 },
        });
        const page = await context.newPage();
        page.setDefaultTimeout(20000);
        const errors = [];
        page.on('pageerror', (error) => errors.push(error.message));
        for (const [mode, url] of [
          ['dev-nested', devUrl],
          ['static-root', staticUrl + '/'],
          ['static-nested', staticUrl + '/nested/'],
        ]) {
          await page.goto(url + '#page=doc:docs--guide&locale=en');
          const frame = page.frameLocator('iframe');
          await frame
            .getByRole('heading', { name: 'Support guide', exact: true })
            .waitFor();
          await frame.getByRole('link', { name: 'Next', exact: true }).click();
          await frame
            .getByRole('heading', { name: 'Next guide', exact: true })
            .waitFor();
          const search = page.getByRole('searchbox');
          await search.fill('supportneedle');
          const guide = page
            .locator('.lab-tree-row')
            .filter({ hasText: 'Guide' });
          assert.equal(await guide.count(), 1);
          await guide.click();
          await frame
            .getByRole('heading', { name: 'Support guide', exact: true })
            .waitFor();
          await search.fill('');
          await page.goto(
            url +
              '#page=docs--react&example=Default&locale=en&theme=dark&panel=code',
          );
          await frame
            .getByRole('button', { name: 'React fixture 0', exact: true })
            .click();
          await frame
            .getByRole('button', { name: 'React fixture 1', exact: true })
            .waitFor();
          assert.equal(
            await frame.locator('html').getAttribute('data-theme'),
            'dark',
          );
          if (mode === 'static-nested') {
            await frame
              .getByRole('button', { name: 'Copy code', exact: true })
              .click();
            await frame
              .getByRole('status')
              .filter({ hasText: 'Copied' })
              .waitFor();
            result.clipboardWrite = 'resolved after user click';
            if (name === 'chrome') {
              assert.equal(
                await page.evaluate(() => navigator.clipboard.readText()),
                '<button>React fixture</button>',
              );
              result.clipboardRead = 'exact fixture text';
            } else
              result.clipboardRead =
                'not requested: no Chromium-specific permission grant';
          }
          await page.goto(url + '#page=docs--native&example=Default&locale=en');
          await frame
            .getByRole('button', { name: 'Native fixture 0', exact: true })
            .click();
          await frame
            .getByRole('button', { name: 'Native fixture 1', exact: true })
            .waitFor();
          await page.reload();
          await frame
            .getByRole('button', { name: 'Native fixture 0', exact: true })
            .waitFor();
          result.journeys.push(mode);
        }
        assert.deepEqual(errors, []);
        result.pageErrors = errors;
      } finally {
        await browser.close();
      }
    }
  } finally {
    dev.kill();
    if (dev.exitCode === null)
      await new Promise((done) => dev.once('exit', done));
    if (staticServer.listening)
      await new Promise((done) => staticServer.close(done));
    report.devServerLog = serverLog;
  }
  report.status = 'passed';
} catch (error) {
  report.status = 'failed';
  report.error = String(error);
  throw error;
} finally {
  await save();
}
console.log(
  JSON.stringify(
    {
      scratch,
      node: report.node,
      npm: report.npm,
      installed: report.installed,
      browsers: report.browsers,
      status: report.status,
    },
    null,
    2,
  ),
);
