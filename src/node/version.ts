import { createRequire } from 'node:module';

// Рядом с dist/ находится манифест именно установленного движка.
const manifest = createRequire(import.meta.url)('../../package.json') as {
  version: string;
};
export const engineVersion: string = manifest.version;
