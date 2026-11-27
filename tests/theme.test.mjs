/**
 * Проверки режима оформления: сохранённая настройка, системный режим
 * и временное переключение через URL. Не требуют браузера.
 * Запуск: npm test.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { compileString } from 'sass';
import { defineConfig } from '../dist/index.js';
import {
  resolveTheme,
  themePreference,
  themeStorageKey,
} from '../dist/runtime/theme.js';

test('saved preference supports light, dark and system, with safe defaults', () => {
  for (const value of ['light', 'dark', 'system'])
    assert.equal(themePreference(value), value);
  for (const value of [null, undefined, '', 'auto', {}, 1]) {
    assert.equal(themePreference(value), 'system');
    assert.equal(themePreference(value, 'dark'), 'dark');
  }
  const config = { name: 'My Project', version: '1', content: ['docs/*.md'] };
  assert.equal(
    defineConfig({ ...config, defaultTheme: 'system' }).defaultTheme,
    'system',
  );
  assert.throws(
    () => defineConfig({ ...config, defaultTheme: 'auto' }),
    /defaultTheme/,
  );
});

test('temporary overrides do not change the saved preference and system mode follows the OS', () => {
  assert.equal(resolveTheme(null, 'system', 'light'), 'light');
  assert.equal(resolveTheme(null, 'system', 'dark'), 'dark');
  assert.equal(resolveTheme(null, 'dark', 'light'), 'dark');
  assert.equal(resolveTheme(null, 'light', 'dark'), 'light');
  assert.equal(resolveTheme('light', 'dark', 'dark'), 'light');
  assert.equal(resolveTheme('dark', 'system', 'light'), 'dark');
  assert.equal(resolveTheme('invalid', 'light', 'dark'), 'light');
});

test('app and preview share the preference within one site, with separate keys for nested sites', () => {
  assert.equal(themeStorageKey('/'), themeStorageKey('/index.html'));
  assert.equal(themeStorageKey('/'), themeStorageKey('/preview.html'));
  assert.equal(
    themeStorageKey('/docs/'),
    themeStorageKey('/docs/preview.html'),
  );
  assert.notEqual(themeStorageKey('/'), themeStorageKey('/docs/'));
});

test('the default SCSS theme compiles with a separate configuration and supports font overrides', () => {
  const styles = fileURLToPath(new URL('../src/assets/styles', import.meta.url));
  const { css } = compileString(
    "@use 'config' with ($code-font-size: 16px); @use 'index';",
    { loadPaths: [styles] },
  );
  assert.match(css, /data-style-theme=default/);
  assert.match(css, /--lab-code-bg: #f4f5fa/);
  assert.match(css, /--lab-code-bg: #1e2230/);
  assert.match(css, /font: 16px\/1\.7/);
});
