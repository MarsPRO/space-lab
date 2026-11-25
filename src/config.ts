import {
  mkdir,
  writeFile,
  realpath,
  readdir,
  lstat,
  readFile,
} from 'node:fs/promises';
import { resolve, relative, isAbsolute, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import type { IncomingMessage, ServerResponse } from 'node:http';
import mdx from '@mdx-js/rollup';
import remarkGfm from 'remark-gfm';
import type { Alias, AliasOptions, InlineConfig, Plugin } from 'vite';
import { mergeConfig } from 'vite';
import type { SpaceLabConfig } from './index.js';
import { discoverContent } from './node/content.js';
import { mcpMiddleware } from './node/mcp.js';
import { visualMiddleware, artifactMiddleware } from './node/visual.js';

import { engineVersion } from './node/version.js';
import { asRecord } from './runtime/data.js';
import { loadSiteI18n } from './node/i18n-config.js';
import { validateDocuments } from './node/document-validation.js';
import { I18nError } from './i18n/registry.js';
import { allowLocalRequest } from './node/local-http.js';

function isAliasArray(aliases: AliasOptions): aliases is readonly Alias[] {
  return Array.isArray(aliases);
}

function middleware(
  handle: (
    request: IncomingMessage,
    response: ServerResponse,
    next: (error?: unknown) => void,
  ) => Promise<void>,
) {
  return (
    request: IncomingMessage,
    response: ServerResponse,
    next: (error?: unknown) => void,
  ) => {
    // Connect ignores returned promises; each handler retains its existing error boundary.
    void handle(request, response, next);
  };
}

const normalize = (path: string) => path.replaceAll('\\', '/');
const asset = (path: string) =>
  normalize(fileURLToPath(new URL(path, import.meta.url)));
const escapeHtml = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (char) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        char
      ] ?? char,
  );

export async function createSite(
  root: string,
  config: SpaceLabConfig,
  outDir = 'space-lab-static',
): Promise<InlineConfig> {
  const cache = resolve(root, 'node_modules/.cache/space-lab');
  const output = resolve(root, outDir);
  const outputRelative = relative(root, output);
  if (
    !outputRelative ||
    outputRelative.startsWith('..') ||
    isAbsolute(outputRelative) ||
    /^(node_modules|src|docs|examples|demo|assets|\.git|\.github)([\\/]|$)/i.test(
      outputRelative,
    )
  ) {
    throw new Error(
      'Space Lab: output directory must be a separate build folder inside the project.',
    );
  }
  const entries = await discoverContent(root, config);
  const i18n = await loadSiteI18n(root, config);
  const documentError = (
    await validateDocuments(root, entries, i18n.registry)
  ).find((issue) => issue.severity === 'error');
  if (documentError)
    throw new I18nError(documentError.code, {
      file: documentError.file ?? '',
      locale: documentError.locale ?? '',
      key: documentError.key ?? '',
    });
  let parent = output;
  for (;;) {
    try {
      const physical = relative(
        await realpath(root),
        resolve(await realpath(parent), relative(parent, output)),
      );
      if (!physical || physical.startsWith('..') || isAbsolute(physical))
        throw new Error('Space Lab: output resolves outside the project.');
      if (
        /^(node_modules|src|docs|examples|demo|assets|\.git|\.github)([\\/]|$)/i.test(
          physical,
        )
      )
        throw new Error('Space Lab: output resolves to a protected directory.');
      for (const entry of entries) {
        const location = relative(
          resolve(await realpath(root), physical),
          await realpath(resolve(root, entry.file)),
        );
        if (!location.startsWith('..') && !isAbsolute(location))
          throw new Error('Space Lab: output contains project materials.');
      }
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      parent = dirname(parent);
    }
  }
  try {
    const existing = await readdir(output);
    const actual = relative(await realpath(root), await realpath(output));
    if (
      actual.startsWith('..') ||
      isAbsolute(actual) ||
      (existing.length && !existing.includes('.space-lab-build'))
    ) {
      throw new Error(
        'Space Lab: refusing to overwrite an unrelated directory.',
      );
    }
    if (existing.length) {
      const marker = resolve(output, '.space-lab-build');
      const info = await lstat(marker);
      if (
        !info.isFile() ||
        info.isSymbolicLink() ||
        (await readFile(marker, 'utf8')) !== 'Space Lab generated site\n'
      )
        throw new Error(
          'Space Lab: refusing to overwrite an unrelated directory.',
        );
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  await mkdir(cache, { recursive: true });
  for (const [name, script] of [
    ['index', 'app'],
    ['preview', 'frame'],
  ]) {
    await writeFile(
      resolve(cache, `${name}.html`),
      `<!doctype html><html lang="${i18n.registry.defaultLocale}" dir="${i18n.registry.locales[i18n.registry.defaultLocale].dir}"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(config.name)}</title><link rel="icon" href="data:,"></head><body><div id="root"></div><script type="module" src="/@fs/${asset(`./client/${script}.js`)}"></script></body></html>`,
    );
  }
  const consumerRequire = createRequire(resolve(root, 'package.json'));
  let development = false;
  const plugin: Plugin = {
    name: 'space-lab',
    configResolved(resolved) {
      development = resolved.command === 'serve';
    },
    resolveId(id) {
      if (id.startsWith('virtual:space-lab/')) return '\0' + id;
    },
    async load(id) {
      if (id === '\0virtual:space-lab/document-catalogs') {
        const current = await discoverContent(root, config);
        return `export const documentCatalogs={${current
          .filter((entry) => entry.shared)
          .map(
            (entry) =>
              `${JSON.stringify(entry.documentPath?.replace(/\.mdx?$/, ''))}:{${Object.entries(
                entry.versions ?? {},
              )
                .filter(([, version]) => version.catalog)
                .map(
                  ([tag, version]) =>
                    `${JSON.stringify(tag)}:()=>import(${JSON.stringify(normalize(resolve(root, version.catalog ?? '')))}).then(module=>module.default)`,
                )
                .join(',')}}`,
          )
          .join(',')}};`;
      }
      if (id === '\0virtual:space-lab/i18n') {
        const current = await loadSiteI18n(root, config);
        return `export const registry=${JSON.stringify(current.registry)};export const schema=${JSON.stringify(current.schema)};export const catalogLoaders={${Object.keys(
          current.registry.locales,
        )
          .map(
            (tag) =>
              `${JSON.stringify(tag)}:()=>import(${JSON.stringify('virtual:space-lab/catalog/' + tag)})`,
          )
          .join(',')}};`;
      }
      if (id.startsWith('\0virtual:space-lab/catalog/')) {
        const tag = id.slice('\0virtual:space-lab/catalog/'.length);
        const current = await loadSiteI18n(root, config);
        const resources = Object.fromEntries(
          Object.entries(current.resources).map(([namespace, translations]) => [
            namespace,
            { [tag]: translations[tag] ?? {} },
          ]),
        );
        return `export default ${JSON.stringify(resources)};`;
      }
      if (id === '\0virtual:space-lab/site')
        return `export const engineVersion=${JSON.stringify(engineVersion)}; export const config=${JSON.stringify({ ...config, i18n: config.i18n ? { ...i18n.registry, schemas: i18n.schema } : undefined })}; export const entries=${JSON.stringify(await discoverContent(root, config))}; export const development=${String(development)};`;
      if (id === '\0virtual:space-lab/content') {
        const current = await discoverContent(root, config);
        return (
          `export const loaders={${current
            .map((entry) =>
              entry.versions
                ? `${JSON.stringify(entry.id)}:(locale)=>({${Object.entries(
                    entry.versions,
                  )
                    .map(
                      ([tag, version]) =>
                        `${JSON.stringify(tag)}:()=>import(${JSON.stringify(normalize(resolve(root, version.file)))})`,
                    )
                    .join(
                      ',',
                    )}}[locale]??(()=>import(${JSON.stringify(normalize(resolve(root, entry.file)))})))()`
                : `${JSON.stringify(entry.id)}:()=>import(${JSON.stringify(normalize(resolve(root, entry.file)))}).then(module=>${entry.kind === 'examples' ? `({...module,default:{...module.default,api:module.default.api??${JSON.stringify(entry.api ?? [])},subcomponentApi:module.default.subcomponentApi??${JSON.stringify(entry.subcomponentApi ?? {})},controls:{...${JSON.stringify(Object.fromEntries((entry.api ?? []).filter((prop) => prop.control).map((prop) => [prop.name, prop.control])))},...module.default.controls}}})` : 'module'})`,
            )
            .join(',')}};` +
          (config.preview
            ? `export {default as preview} from ${JSON.stringify(normalize(resolve(root, config.preview)))};`
            : 'export const preview={};')
        );
      }
    },
    configureServer(server) {
      // Guard all routes, including Vite source serving and Origin-less navigations.
      server.middlewares.use((request, response, next) => {
        if (allowLocalRequest(request, response)) next();
      });
      server.middlewares.use(
        '/__space-lab/visual',
        middleware(visualMiddleware(root, config)),
      );
      server.middlewares.use(
        '/__space-lab/artifacts',
        middleware(artifactMiddleware(root)),
      );
      if (config.mcp !== false)
        server.middlewares.use('/mcp', middleware(mcpMiddleware(root, config)));
      server.middlewares.use(
        '/index.json',
        middleware(async (_request, response, next) => {
          try {
            response.setHeader('Content-Type', 'application/json');
            response.end(JSON.stringify(await discoverContent(root, config)));
          } catch (error) {
            next(error);
          }
        }),
      );
      // Изменение материалов обновляет индекс и страницу без перезапуска CLI.
      const update = (file: string) => {
        if (file.includes('node_modules') || file.startsWith(output)) return;
        if (/\.(mdx?|tsx?|jsx?|json)$/.test(file)) {
          for (const id of [
            '\0virtual:space-lab/site',
            '\0virtual:space-lab/content',
            '\0virtual:space-lab/i18n',
            '\0virtual:space-lab/document-catalogs',
            ...Object.keys(i18n.registry.locales).map(
              (tag) => '\0virtual:space-lab/catalog/' + tag,
            ),
          ]) {
            const module = server.moduleGraph.getModuleById(id);
            if (module) server.moduleGraph.invalidateModule(module);
          }
          server.ws.send({ type: 'full-reload' });
        }
      };
      server.watcher.add(root);
      server.watcher
        .on('add', update)
        .on('unlink', update)
        .on('change', update);
      server.httpServer?.once('close', () =>
        server.watcher
          .off('add', update)
          .off('unlink', update)
          .off('change', update),
      );
    },
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'i18n.json',
        source: JSON.stringify({
          registry: i18n.registry,
          schema: i18n.schema,
        }),
      });
      this.emitFile({
        type: 'asset',
        fileName: 'index.json',
        source: JSON.stringify(entries),
      });
      this.emitFile({
        type: 'asset',
        fileName: '.space-lab-build',
        source: 'Space Lab generated site\n',
      });
    },
  };
  const base = {
    configFile: false,
    envDir: false,
    root: cache,
    base: config.base ?? './',
    publicDir: false,
    plugins: [plugin, mdx({ include: /\.mdx?$/, remarkPlugins: [remarkGfm] })],
    resolve: {
      alias: {
        'react-dom/client': consumerRequire.resolve('react-dom/client'),
        'react/jsx-runtime': consumerRequire.resolve('react/jsx-runtime'),
        'react/jsx-dev-runtime': consumerRequire.resolve(
          'react/jsx-dev-runtime',
        ),
        'react-dom': consumerRequire.resolve('react-dom'),
        react: consumerRequire.resolve('react'),
        'space-lab/react': asset('./react.js'),
        'space-lab/testing': asset('./runtime/scenario.js'),
        'space-lab/renderers': asset('./renderers.js'),
        'space-lab': asset('./client/browser.js'),
      },
      dedupe: ['react', 'react-dom'],
    },
    server: {
      host: '127.0.0.1',
      cors: false,
      port: 6006,
      strictPort: true,
      fs: {
        allow: [
          await realpath(root),
          fileURLToPath(new URL('..', import.meta.url)),
        ],
      },
    },
    optimizeDeps: {
      // Public hooks and the frame's relative imports must share module identity.
      exclude: ['space-lab'],
      include: [
        'react',
        'react-dom/client',
        'react/jsx-runtime',
        '@testing-library/dom',
        '@testing-library/user-event',
        'axe-core',
      ],
    },
    oxc: { jsx: { runtime: 'automatic' } },
    build: {
      outDir: output,
      emptyOutDir: true,
      rolldownOptions: {
        output: { comments: { legal: true, annotation: false, jsdoc: false } },
        input: {
          index: resolve(cache, 'index.html'),
          preview: resolve(cache, 'preview.html'),
        },
      },
    },
  } satisfies InlineConfig;
  if (!config.vite) return base;
  const module: unknown = await import(
    pathToFileURL(resolve(root, config.vite)).href
  );
  const extension = asRecord(module).default;
  if (!extension || typeof extension !== 'object')
    throw new Error(
      'Space Lab: vite module must export a configuration object.',
    );
  const merged = mergeConfig(base, extension) as InlineConfig;
  const aliases = merged.resolve?.alias ?? [];
  return {
    ...merged,
    root: cache,
    configFile: false,
    envDir: false,
    base: base.base,
    resolve: {
      ...merged.resolve,
      alias: [
        ...Object.entries(base.resolve.alias).map(([find, replacement]) => ({
          find,
          replacement,
        })),
        ...(isAliasArray(aliases)
          ? aliases
          : Object.entries(aliases).map(([find, replacement]) => ({
              find,
              replacement,
            }))),
      ],
    },
    server: {
      ...merged.server,
      host: '127.0.0.1',
      cors: false,
      strictPort: true,
      fs: { ...merged.server?.fs, allow: base.server.fs.allow },
    },
    build: {
      ...merged.build,
      outDir: output,
      emptyOutDir: true,
      rolldownOptions: {
        ...merged.build?.rolldownOptions,
        input: base.build.rolldownOptions.input,
      },
    },
  };
}
