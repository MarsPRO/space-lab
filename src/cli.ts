#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

import { defineConfig } from './index.js';
import type { SpaceLabConfig } from './index.js';
import { I18nError } from './i18n/registry.js';
import { diagnosticFromError } from './i18n/diagnostics.js';

import { engineVersion } from './node/version.js';

async function loadConfig(root: string) {
  // Dynamic import cannot infer the consumer's module; defineConfig validates its default export at runtime.
  const module = (await import(
    pathToFileURL(resolve(root, 'space-lab.config.mjs')).href
  )) as { default: SpaceLabConfig };
  return defineConfig(module.default);
}

const [command, ...args] = process.argv.slice(2);
const help =
  'Space Lab\n  space-lab dev [--port 6006]\n  space-lab build [--output-dir space-lab-static]\n  space-lab test [--locale <tag>] [--interactions] [--a11y] [--visual] [--update]\n  space-lab check-i18n [--json] [--strict]\n\nConfiguration: space-lab.config.mjs';
try {
  if (command === '--version' || command === '-v') console.log(engineVersion);
  else if (!command || command === '--help') console.log(help);
  else if (command === 'check-i18n') {
    if (
      args.some((flag) => !['--json', '--strict'].includes(flag)) ||
      new Set(args).size !== args.length
    )
      throw new I18nError('invalid_check_i18n_option');
    const { checkI18n } = await import('./node/check-i18n.js');
    const report = await checkI18n(
      process.cwd(),
      await loadConfig(process.cwd()),
      args.includes('--strict'),
    );
    if (args.includes('--json')) console.log(JSON.stringify(report));
    else {
      for (const row of report.locales) {
        console.log(
          `${row.locale} (${row.status}): documents ${String(row.documents.complete)}/${String(row.documents.expected)} complete, ${String(row.documents.present)} present`,
        );
        for (const catalog of row.catalogs)
          console.log(
            `  ${catalog.namespace}: ${String(catalog.complete)}/${String(catalog.families)} families, ${String(catalog.missing.length)} missing keys`,
          );
      }
      for (const issue of report.diagnostics)
        console.log(
          `${issue.severity}: ${issue.code} ${issue.locale ?? ''} ${issue.file ?? ''} ${issue.namespace ?? ''} ${issue.key ?? ''}${issue.missing ? ` missing: ${issue.missing.join(', ')}` : ''}`,
        );
      console.log(
        `${report.ok ? 'PASS' : 'FAIL'}: ${String(report.diagnostics.filter((issue) => issue.severity === 'error').length)} errors, ${String(report.diagnostics.filter((issue) => issue.severity === 'incomplete').length)} allowed incomplete, ${String(report.diagnostics.filter((issue) => issue.severity === 'warning').length)} warnings. Structural checks do not establish editorial acceptance.`,
      );
    }
    if (!report.ok) process.exitCode = 1;
  } else {
    if (!['dev', 'build', 'test'].includes(command))
      throw new Error(`Unknown command: ${command}`);
    if (command === 'test') {
      const root = process.cwd(),
        config = await loadConfig(root);
      const { runProjectTests } = await import('./node/runner.js');
      await runProjectTests(root, config, args);
    } else {
      const { createServer, build } = await import('vite');
      const { createSite } = await import('./config.js');
      let port = 6006,
        output = 'space-lab-static';
      for (let index = 0; index < args.length; index++) {
        const flag = args[index],
          value = args[++index];
        if (!value || (flag !== '--port' && flag !== '--output-dir'))
          throw new Error(`Invalid option: ${flag}`);
        if (flag === '--port') {
          port = Number(value);
          if (!Number.isInteger(port) || port < 1 || port > 65535)
            throw new Error('Invalid port.');
        } else output = value;
      }
      const root = process.cwd();
      const config = await loadConfig(root);
      const site = await createSite(root, config, output);
      if (command === 'build') await build(site);
      else {
        const server = await createServer({
          ...site,
          server: { ...site.server, port },
        });
        await server.listen();
        console.log(`Space Lab · ${config.name} ${config.version}`);
        server.printUrls();
        if (config.mcp !== false)
          console.log(`MCP: http://127.0.0.1:${String(port)}/mcp`);
        for (const signal of ['SIGINT', 'SIGTERM'] as const)
          process.once(signal, () => {
            void server.close().then(() => process.exit(0));
          });
      }
    }
  }
} catch (error) {
  if (command === 'check-i18n' && args.includes('--json')) {
    console.log(
      JSON.stringify({
        ok: false,
        locales: [],
        diagnostics: [
          {
            ...diagnosticFromError(error, 'configuration_error'),
            file: 'space-lab.config.mjs',
          },
        ],
      }),
    );
    process.exitCode = 1;
  } else {
    console.error(
      `Space Lab: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  }
}
