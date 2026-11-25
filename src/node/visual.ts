import { resolveRoute } from '../runtime/routes.js';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import {
  readFile,
  writeFile,
  mkdir,
  realpath,
  rename,
  lstat,
} from 'node:fs/promises';
import { resolve, relative, isAbsolute, dirname } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import { discoverContent } from './content.js';
import type { SpaceLabConfig } from '../index.js';
import type { AccessibilityReport } from '../runtime/browser-types.js';
import type { ScenarioSnapshot } from '../runtime/scenario.js';
import type { BrowserType } from 'playwright';
import { createLocaleRegistry, resolveSiteLocale } from '../i18n/registry.js';
import {
  allowLocalRequest,
  hasJsonContentType,
  readRequestBody,
} from './local-http.js';
import { isRecord } from '../runtime/data.js';
import { projectPath } from './i18n-config.js';

export interface CaptureOptions {
  page: string;
  example: string;
  locale?: string;
  theme?: 'light' | 'dark';
  args?: string;
  globals?: Record<string, unknown>;
  update?: boolean;
  interactions?: boolean;
  accessibility?: boolean;
  visual?: boolean;
  width?: number;
  height?: number;
}
export interface CaptureResult {
  status: 'passed' | 'changed' | 'missing' | 'updated';
  page: string;
  example: string;
  diffPixels?: number;
  images?: Record<string, string>;
  scenario?: ScenarioSnapshot;
  accessibility?: AccessibilityReport;
}
function validateCaptureOptions(
  value: unknown,
): asserts value is CaptureOptions {
  if (
    !isRecord(value) ||
    !['page', 'example'].every(
      (key) =>
        typeof value[key] === 'string' &&
        value[key].length > 0 &&
        value[key].length <= 4096,
    ) ||
    !['update', 'interactions', 'accessibility', 'visual'].every(
      (key) => value[key] === undefined || typeof value[key] === 'boolean',
    ) ||
    !['width', 'height'].every(
      (key) =>
        value[key] === undefined ||
        (typeof value[key] === 'number' &&
          Number.isInteger(value[key]) &&
          value[key] >= 240 &&
          value[key] <= 4000),
    ) ||
    (value.locale !== undefined &&
      (typeof value.locale !== 'string' || value.locale.length > 100)) ||
    (value.theme !== undefined &&
      value.theme !== 'light' &&
      value.theme !== 'dark') ||
    (value.args !== undefined &&
      (typeof value.args !== 'string' || value.args.length > 1_000_000)) ||
    (value.globals !== undefined && !isRecord(value.globals))
  )
    throw new Error('Space Lab: invalid capture options.');
}
async function safeFolder(root: string, target: string) {
  let parent = target;
  for (;;) {
    try {
      const location = relative(await realpath(root), await realpath(parent));
      if (location.startsWith('..') || isAbsolute(location))
        throw new Error('Space Lab: visual artifacts resolve outside project.');
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      parent = dirname(parent);
    }
  }
  await mkdir(target, { recursive: true });
}
const activeCaptures = new Set<string>();
async function rejectFileLink(path: string) {
  try {
    if ((await lstat(path)).isSymbolicLink())
      throw new Error(
        'Space Lab: visual artifact must not be a symbolic link.',
      );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}
export async function captureExample(
  root: string,
  config: SpaceLabConfig,
  origin: string,
  options: CaptureOptions,
): Promise<CaptureResult> {
  validateCaptureOptions(options);
  const locale = resolveSiteLocale(
    options.locale,
    createLocaleRegistry(config.i18n, config.defaultLocale),
  );
  const project = await realpath(root);
  if (activeCaptures.has(project))
    throw new Error('Space Lab: a browser check is already running.');
  activeCaptures.add(project);
  try {
    return await captureChecked(project, config, origin, options, locale);
  } finally {
    activeCaptures.delete(project);
  }
}
async function captureChecked(
  root: string,
  config: SpaceLabConfig,
  origin: string,
  options: CaptureOptions,
  locale: string,
): Promise<CaptureResult> {
  const entries = await discoverContent(root, config),
    entry = resolveRoute(entries, options.page);
  if (entry?.kind !== 'examples' || !entry.examples?.includes(options.example))
    throw new Error('Space Lab: unknown example.');
  const consumerRequire = createRequire(resolve(root, 'package.json'));
  let playwright: { chromium: BrowserType };
  try {
    // Consumer-resolved packages may expose either ESM or CJS exports.
    const module = (await import(
      pathToFileURL(consumerRequire.resolve('playwright')).href
    )) as { chromium?: BrowserType; default: { chromium: BrowserType } };
    playwright = { chromium: module.chromium ?? module.default.chromium };
  } catch {
    throw new Error(
      'Space Lab: install playwright in this project to run browser checks.',
    );
  }
  const theme = options.theme ?? config.defaultTheme ?? 'light';
  const width = Math.max(240, Math.min(4000, Number(options.width) || 1280)),
    height = Math.max(240, Math.min(4000, Number(options.height) || 800));
  const key = createHash('sha256')
    .update(
      JSON.stringify([entry.id, options.example, locale, theme, width, height]),
    )
    .digest('hex')
    .slice(0, 32);
  const artifacts = resolve(root, 'node_modules/.cache/space-lab/visual', key),
    baselines = resolve(root, config.testDirectory ?? 'tests/visual');
  await safeFolder(root, artifacts);
  await safeFolder(root, baselines);
  for (const name of ['current', 'baseline', 'diff'])
    await rejectFileLink(resolve(artifacts, `${name}.png`));
  await rejectFileLink(resolve(baselines, `${key}.png`));
  const result: CaptureResult = {
    status: 'passed',
    page: entry.id,
    example: options.example,
  };
  const browser = await playwright.chromium.launch({
    channel: 'chrome',
    headless: true,
  });
  try {
    const context = await browser.newContext({
      viewport: { width, height },
      deviceScaleFactor: 1,
      colorScheme: theme,
      reducedMotion: 'reduce',
    });
    const page = await context.newPage(),
      errors: string[] = [];
    page.on('pageerror', (error: Error) => {
      errors.push(error.message);
    });
    const params = new URLSearchParams({
      page: entry.id,
      example: options.example,
      locale,
      theme,
    });
    if (options.args) params.set('args', options.args);
    if (options.globals) params.set('globals', JSON.stringify(options.globals));
    if (options.interactions) params.set('test', '1');
    const base = config.base?.startsWith('/') ? config.base : '/';
    await page.goto(
      new URL(base + 'preview.html#' + params.toString(), origin).href,
    );
    await page.waitForFunction(
      () =>
        !!window.__SPACE_LAB_TEST__?.ready ||
        !!window.__SPACE_LAB_TEST__?.error ||
        !!document.querySelector('.lab-error'),
      null,
      { timeout: 30_000 },
    );
    if (await page.locator('.lab-error').count())
      throw new Error(await page.locator('.lab-error').first().innerText());
    const initial = await page.evaluate(() => window.__SPACE_LAB_TEST__);
    if (initial?.error) throw new Error(initial.error);
    await page
      .locator('.lab-live-area[data-ready=true]')
      .waitFor({ timeout: 30_000 });
    await page.waitForFunction(() => !!window.__SPACE_LAB_TEST__?.ready, null, {
      timeout: 30_000,
    });
    if (await page.locator('.lab-renderer-host').count())
      await page
        .locator('.lab-renderer-host[data-renderer-ready=true]')
        .waitFor({ timeout: 30_000 });
    if (options.interactions) {
      await page.waitForFunction(
        () =>
          ['idle', 'passed', 'failed', 'stopped'].includes(
            window.__SPACE_LAB_TEST__?.scenario?.status ?? '',
          ),
        null,
        { timeout: 30_000 },
      );
      result.scenario = await page.evaluate(
        () => window.__SPACE_LAB_TEST__?.scenario,
      );
      if (
        result.scenario?.status === 'failed' ||
        result.scenario?.status === 'stopped'
      )
        result.status = 'changed';
    }
    await page
      .locator('.lab-live-area[data-ready=true]')
      .waitFor({ timeout: 30_000 });
    await page.waitForFunction(() => !!window.__SPACE_LAB_TEST__?.ready, null, {
      timeout: 30_000,
    });
    const runtime = await page.evaluate(() => window.__SPACE_LAB_TEST__);
    if (runtime?.error) throw new Error(runtime.error);
    if (await page.locator('.lab-live-area .lab-error').count())
      throw new Error(
        await page.locator('.lab-live-area .lab-error').innerText(),
      );
    if (options.accessibility) {
      result.accessibility = await page.evaluate(() => {
        const scan = window.__SPACE_LAB_A11Y__;
        if (!scan)
          throw new Error('Space Lab: accessibility runtime is unavailable.');
        return scan();
      });
      if (result.accessibility.violations.length) result.status = 'changed';
    }
    if (errors.length) throw new Error(errors.join('\n'));
    if (options.visual !== false) {
      await page.evaluate(async () => {
        await document.fonts.ready;
        await Promise.allSettled(
          [...document.querySelectorAll('.lab-live-area img')].map((image) =>
            (image as HTMLImageElement).decode(),
          ),
        );
        await new Promise(requestAnimationFrame);
        await new Promise(requestAnimationFrame);
      });
      const current = await page
        .locator('.lab-live-area')
        .screenshot({ animations: 'disabled', caret: 'hide' });
      await writeFile(resolve(artifacts, 'current.png'), current);
      const baselinePath = resolve(baselines, `${key}.png`);
      result.images = { current: `/__space-lab/artifacts/${key}/current.png` };
      if (options.update && result.status === 'passed') {
        await safeFolder(root, baselines);
        const temporary = `${baselinePath}.${String(process.pid)}.tmp`;
        await writeFile(temporary, current, { flag: 'wx' });
        await rename(temporary, baselinePath);
        await writeFile(resolve(artifacts, 'baseline.png'), current);
        result.images.baseline = `/__space-lab/artifacts/${key}/baseline.png`;
        result.status = 'updated';
      } else {
        let baseline;
        try {
          baseline = await readFile(baselinePath);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
        if (!baseline) {
          if (result.status === 'passed') result.status = 'missing';
        } else {
          await writeFile(resolve(artifacts, 'baseline.png'), baseline);
          const first = PNG.sync.read(baseline),
            second = PNG.sync.read(current),
            width = Math.max(first.width, second.width),
            height = Math.max(first.height, second.height);
          const canvas = (image: PNG) => {
            const target = new PNG({ width, height });
            PNG.bitblt(image, target, 0, 0, image.width, image.height, 0, 0);
            return target;
          };
          const diff = new PNG({ width, height });
          result.diffPixels = pixelmatch(
            canvas(first).data,
            canvas(second).data,
            diff.data,
            width,
            height,
            { threshold: 0.1 },
          );
          await writeFile(resolve(artifacts, 'diff.png'), PNG.sync.write(diff));
          result.images.baseline = `/__space-lab/artifacts/${key}/baseline.png`;
          result.images.diff = `/__space-lab/artifacts/${key}/diff.png`;
          if (
            first.width !== second.width ||
            first.height !== second.height ||
            result.diffPixels > 0
          )
            result.status = 'changed';
        }
      }
    }
    return result;
  } finally {
    await browser.close();
  }
}
export function visualMiddleware(root: string, config: SpaceLabConfig) {
  let busy = false;
  return async (request: IncomingMessage, response: ServerResponse) => {
    if (!allowLocalRequest(request, response)) return;
    if (request.method !== 'POST') {
      response.writeHead(405, { Allow: 'POST' }).end();
      return;
    }
    if (busy) {
      response
        .writeHead(409)
        .end(JSON.stringify({ error: 'A browser check is already running.' }));
      return;
    }
    if (!hasJsonContentType(request)) {
      response.writeHead(415).end();
      return;
    }
    try {
      const raw = await readRequestBody(request, response, 2_000_000);
      if (raw === undefined) return;
      const options = JSON.parse(raw) as CaptureOptions;
      busy = true;
      const result = await captureExample(
        root,
        config,
        `http://${String(request.headers.host)}`,
        options,
      );
      response
        .writeHead(200, { 'Content-Type': 'application/json' })
        .end(JSON.stringify(result));
    } catch (error) {
      response.writeHead(400, { 'Content-Type': 'application/json' }).end(
        JSON.stringify({
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    } finally {
      busy = false;
    }
  };
}
export function artifactMiddleware(root: string) {
  return async (request: IncomingMessage, response: ServerResponse) => {
    if (!allowLocalRequest(request, response)) return;
    const match = /^\/([a-f0-9]{32})\/(current|baseline|diff)\.png$/.exec(
      request.url ?? '',
    );
    if (!match || request.method !== 'GET') {
      response.writeHead(404).end();
      return;
    }
    try {
      const data = await readFile(
        await projectPath(
          root,
          `node_modules/.cache/space-lab/visual/${match[1]}/${match[2]}.png`,
        ),
      );
      response
        .writeHead(200, {
          'Content-Type': 'image/png',
          'Cache-Control': 'no-store',
        })
        .end(data);
    } catch {
      response.writeHead(404).end();
    }
  };
}
