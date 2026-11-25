import { createServer } from 'vite';
import { createSite } from '../config.js';
import { discoverContent } from './content.js';
import { captureExample } from './visual.js';
import type { SpaceLabConfig } from '../index.js';
import { createLocaleRegistry, resolveSiteLocale } from '../i18n/registry.js';

export async function runProjectTests(
  root: string,
  config: SpaceLabConfig,
  args: string[],
) {
  let requestedLocale: string | undefined;
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (flag === '--locale') {
      if (
        requestedLocale !== undefined ||
        !args[index + 1] ||
        args[index + 1].startsWith('--')
      )
        throw new Error('Space Lab: --locale requires one locale.');
      requestedLocale = args[++index];
    } else if (
      !['--update', '--a11y', '--visual', '--interactions'].includes(flag)
    )
      throw new Error('Space Lab: unknown test option.');
  }
  const locale = resolveSiteLocale(
    requestedLocale,
    createLocaleRegistry(config.i18n, config.defaultLocale),
  );
  const entries = await discoverContent(root, config),
    site = await createSite(root, config);
  const server = await createServer({
    ...site,
    server: { ...site.server, port: 0 },
  });
  await server.listen();
  const address = server.httpServer?.address();
  if (!address || typeof address === 'string')
    throw new Error('Space Lab: test server did not start.');
  const origin = `http://127.0.0.1:${String(address.port)}`;
  let failures = 0,
    total = 0;
  try {
    for (const entry of entries)
      for (const example of entry.examples ?? []) {
        total++;
        try {
          const result = await captureExample(root, config, origin, {
            page: entry.id,
            locale,
            example,
            interactions: true,
            accessibility: args.includes('--a11y'),
            visual: args.includes('--visual') || args.includes('--update'),
            update: args.includes('--update'),
          });
          const failed = !['passed', 'updated'].includes(result.status);
          if (failed) failures++;
          console.log(
            `${failed ? 'FAIL' : 'PASS'} ${entry.id}/${example} · ${result.status}`,
          );
          if (result.scenario?.error) console.error(result.scenario.error);
          if (result.accessibility?.violations.length)
            console.error(
              JSON.stringify(result.accessibility.violations, null, 2),
            );
        } catch (error) {
          failures++;
          console.error(
            `FAIL ${entry.id}/${example}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    console.log(
      `Space Lab: ${String(total - failures)}/${String(total)} passed.`,
    );
    if (failures) process.exitCode = 1;
  } finally {
    await server.close();
  }
}
