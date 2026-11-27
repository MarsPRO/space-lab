/**
 * Браузерная проверка сохранённой настройки, временного переключателя,
 * системного режима и цветов кода в dev и статической сборке.
 * Использует изолированный проект и установленный Chrome. Запуск: npm run test:theme.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  symlink,
  rm,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer as createHttpServer } from 'node:http';
import { createServer, build } from 'vite';
import { chromium } from 'playwright';
import { createSite } from '../../dist/config.js';

const packageRoot = fileURLToPath(new URL('../..', import.meta.url));

async function appearance(page, theme) {
  await page.waitForFunction(
    (value) => document.documentElement.dataset.theme === value,
    theme,
  );
  await page
    .frameLocator('iframe')
    .locator(`html[data-theme="${theme}"]`)
    .waitFor();
}

async function checkSettings(browser, base) {
  const context = await browser.newContext({
    colorScheme: 'light',
    viewport: { width: 1280, height: 850 },
  });
  try {
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(base);
    await appearance(page, 'light');
    await page.getByRole('button', { name: 'Настройки', exact: true }).click();
    const appearanceTheme = page.getByRole('combobox', {
      name: 'Тема оформления',
      exact: true,
    });
    assert.equal(await appearanceTheme.inputValue(), 'default');
    assert.deepEqual(
      await appearanceTheme.locator('option').allTextContents(),
      ['По умолчанию'],
    );
    const preference = page.getByRole('combobox', {
      name: 'Тема по умолчанию',
      exact: true,
    });
    assert.deepEqual(
      await preference
        .locator('option')
        .evaluateAll((nodes) => nodes.map((n) => n.value)),
      ['light', 'dark', 'system'],
    );
    assert.equal(await preference.inputValue(), 'system');
    await preference.selectOption('dark');
    await appearance(page, 'dark');
    await page
      .getByRole('switch', { name: 'Переключить тему', exact: true })
      .click();
    await appearance(page, 'light');
    assert.equal(await preference.inputValue(), 'dark');
    assert.equal(
      await page.evaluate(() =>
        localStorage.getItem('space-lab:theme-preference:/'),
      ),
      'dark',
    );

    const fresh = await context.newPage();
    await fresh.goto(base);
    await appearance(fresh, 'dark');
    await fresh.close();

    await preference.selectOption('system');
    await appearance(page, 'light');
    assert.equal(new URL(page.url()).hash.includes('theme='), false);
    await page.emulateMedia({ colorScheme: 'dark' });
    await appearance(page, 'dark');
    await page.getByRole('button', { name: 'Настройки', exact: true }).click();
    await page
      .locator('.lab-spaces')
      .getByRole('link', { name: 'Площадка', exact: true })
      .click();
    await page.emulateMedia({ colorScheme: 'light' });
    await appearance(page, 'light');
    assert.equal(new URL(page.url()).hash.includes('theme='), false);
    await page
      .getByRole('switch', { name: 'Переключить тему', exact: true })
      .click();
    await appearance(page, 'dark');
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.emulateMedia({ colorScheme: 'light' });
    await appearance(page, 'dark');
    assert.equal(
      await page.evaluate(() =>
        localStorage.getItem('space-lab:theme-preference:/'),
      ),
      'system',
    );

    for (const theme of ['light', 'dark']) {
      const expected =
        theme === 'light' ? 'rgb(244, 245, 250)' : 'rgb(30, 34, 48)';
      for (const route of ['doc:docs--guide', 'examples:components--button']) {
        await page.goto(
          `${base}#page=${route}&example=Main&panel=code&theme=${theme}`,
        );
        const code = page
          .frameLocator('iframe')
          .locator('pre[data-highlighted="true"]')
          .first();
        await code.waitFor();
        const style = await code.evaluate((element) => ({
          background: getComputedStyle(element).backgroundColor,
          font: getComputedStyle(element).fontSize,
          colors: [
            ...new Set(
              [...element.querySelectorAll('.token')].map(
                (token) => getComputedStyle(token).color,
              ),
            ),
          ],
        }));
        assert.equal(style.background, expected);
        assert.equal(style.font, '14px');
        assert.ok(style.colors.length > 1);
      }
    }
    await page.goto(base);
    await appearance(page, 'light');
    await page.getByRole('button', { name: 'Настройки', exact: true }).click();
    await page
      .getByRole('combobox', { name: 'Тема по умолчанию', exact: true })
      .selectOption('dark');
    await appearance(page, 'dark');
    await page.goto(`${base}preview.html#page=doc:docs--guide`);
    await page.waitForFunction(
      () => document.documentElement.dataset.theme === 'dark',
    );
    await page.goto(`${base}#locale=en`);
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    const englishTheme = page.getByRole('combobox', {
      name: 'Appearance theme',
      exact: true,
    });
    assert.equal(await englishTheme.inputValue(), 'default');
    assert.deepEqual(await englishTheme.locator('option').allTextContents(), [
      'Default',
    ]);
    assert.deepEqual(errors, []);

    const blocked = await browser.newContext({ colorScheme: 'light' });
    try {
      await blocked.addInitScript(() => {
        Object.defineProperty(window, 'localStorage', {
          get() {
            throw new DOMException('Blocked', 'SecurityError');
          },
        });
      });
      const noStorage = await blocked.newPage();
      await noStorage.goto(base);
      await appearance(noStorage, 'light');
      await noStorage
        .getByRole('button', { name: 'Настройки', exact: true })
        .click();
      await noStorage
        .getByRole('combobox', { name: 'Тема по умолчанию', exact: true })
        .selectOption('dark');
      await appearance(noStorage, 'dark');
    } finally {
      await blocked.close();
    }
  } finally {
    await context.close();
  }
}

test(
  'theme settings and code colors work independently of content in dev and static builds',
  { timeout: 120_000 },
  async (t) => {
    const root = await mkdtemp(resolve(tmpdir(), 'space-lab-appearance-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    await symlink(
      resolve(packageRoot, 'node_modules'),
      resolve(root, 'node_modules'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    await mkdir(resolve(root, 'docs'));
    await mkdir(resolve(root, 'components'));
    await writeFile(
      resolve(root, 'docs/Guide.md'),
      '# Guide\n\n```tsx\nconst Button = () => <button disabled={false}>Save</button>;\n```\n',
    );
    await writeFile(
      resolve(root, 'components/Button.examples.jsx'),
      `function Button({label}) { return <button>{label}</button>; } export default {title:'Components/Button',component:Button,args:{label:'Save'},examples:{Main:{}}};`,
    );
    const config = {
      name: 'Appearance',
      version: '1',
      content: ['docs/*.md', 'components/*.examples.jsx'],
      home: 'doc:docs--guide',
      defaultTheme: 'system',
      mcp: false,
    };
    const site = await createSite(root, config);
    const server = await createServer({
      ...site,
      server: { ...site.server, port: 0 },
    });
    const browser = await chromium.launch({
      channel: 'chrome',
      headless: true,
    });
    try {
      await server.listen();
      await t.test('development', () =>
        checkSettings(
          browser,
          `http://127.0.0.1:${server.httpServer.address().port}/`,
        ),
      );
      await server.close();
      await build(site);
      const output = resolve(root, 'space-lab-static');
      const staticServer = createHttpServer((request, response) => {
        const path = resolve(
          output,
          '.' +
            new URL(request.url, 'http://localhost').pathname.replace(
              /\/$/,
              '/index.html',
            ),
        );
        if (!path.startsWith(output + sep)) {
          response.writeHead(403).end();
          return;
        }
        const types = {
          '.html': 'text/html',
          '.js': 'text/javascript',
          '.css': 'text/css',
          '.json': 'application/json',
        };
        void readFile(path)
          .then((body) => {
            response
              .writeHead(200, {
                'Content-Type':
                  types[extname(path)] ?? 'application/octet-stream',
              })
              .end(body);
          })
          .catch(() => {
            response.writeHead(404).end();
          });
      });
      try {
        await new Promise((resolve) =>
          staticServer.listen(0, '127.0.0.1', resolve),
        );
        await t.test('static', () =>
          checkSettings(
            browser,
            `http://127.0.0.1:${staticServer.address().port}/`,
          ),
        );
      } finally {
        await new Promise((resolve) => staticServer.close(resolve));
      }
    } finally {
      await browser.close();
      await server.close();
    }
  },
);
