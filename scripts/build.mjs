import { rm, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { compile } from 'sass';

const root = fileURLToPath(new URL('..', import.meta.url));
const output = resolve(root, 'dist');
if (output !== resolve(root, './dist') || output === root)
  throw new Error('Invalid build directory.');
await rm(output, { recursive: true, force: true });
const result = spawnSync(
  process.execPath,
  [
    resolve(root, 'node_modules/typescript/bin/tsc'),
    '-p',
    resolve(root, 'tsconfig.json'),
  ],
  { stdio: 'inherit' },
);
if (result.status !== 0) process.exit(result.status ?? 1);
await mkdir(resolve(output, 'client'), { recursive: true });
const stylesheet = compile(resolve(root, 'src/assets/styles/index.scss'), {
  style: 'expanded',
  charset: false,
});
await writeFile(resolve(output, 'client/style.css'), stylesheet.css);
