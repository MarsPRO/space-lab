import { resolveRoute } from '../runtime/routes.js';
import { readFile, realpath } from 'node:fs/promises';
import { relative, resolve, extname, isAbsolute, dirname } from 'node:path';
import glob from 'fast-glob';
import { parse, parseExpression } from '@babel/parser';
import type { SpaceLabConfig, Text, ApiProp } from '../index.js';
import { extractApi } from './docgen.js';
import { applySharedDocuments } from './shared-documents.js';
import { loadDocumentRoots, projectPath } from './i18n-config.js';
import type { Node } from '@babel/types';
import { asRecord } from '../runtime/data.js';
import { diagnosticFromError } from '../i18n/diagnostics.js';
import type { I18nDiagnostic } from '../i18n/diagnostics.js';
import {
  isLocalizedText,
  createLocaleRegistry,
  resolveText,
  I18nError,
} from '../i18n/registry.js';

export interface DocumentVersion {
  file: string;
  catalog?: string;
  title: Text;
  description?: Text;
  search: string;
  source?: string;
  status: 'complete' | 'draft';
}
export interface ContentEntry {
  id: string;
  aliases?: string[];
  file: string;
  title: Text;
  description?: Text;
  order?: number;
  kind: 'document' | 'examples';
  search: string;
  source?: string;
  examples?: string[];
  exampleNames?: Record<string, Text>;
  api?: ApiProp[];
  subcomponentApi?: Record<string, ApiProp[]>;
  versions?: Record<string, DocumentVersion>;
  documentPath?: string;
  localized?: boolean;
  shared?: boolean;
  catalogFiles?: Record<string, string>;
  translationDiagnostics?: I18nDiagnostic[];
  group?: string;
}
// Индекс читает литералы метаданных, не исполняя код потребителя на сервере.
function literal(node: Node | null | undefined): unknown {
  if (!node) return undefined;
  if (
    node.type === 'TSAsExpression' ||
    node.type === 'TSSatisfiesExpression' ||
    node.type === 'TSNonNullExpression'
  )
    return literal(node.expression);
  if (node.type.endsWith('Literal') && 'value' in node) return node.value;
  if (node.type === 'ArrayExpression') return node.elements.map(literal);
  if (node.type === 'ObjectExpression')
    return Object.fromEntries(
      node.properties.flatMap((property) => {
        if (property.type !== 'ObjectProperty' || property.computed) return [];
        return [
          [
            property.key.type === 'Identifier'
              ? property.key.name
              : String(literal(property.key)),
            literal(property.value),
          ],
        ];
      }),
    );
  if (node.type === 'UnaryExpression' && node.operator === '-')
    return -Number(literal(node.argument));
  return undefined;
}
function documentMetadata(source: string) {
  const match = /export\s+const\s+meta\s*=\s*/.exec(source);
  if (!match) return undefined;
  const start = match.index + match[0].length;
  let depth = 0,
    quote = '',
    escaped = false;
  for (let index = start; index < source.length; index++) {
    const char = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = '';
    } else if ('\'"`'.includes(char)) quote = char;
    else if (char === '{') depth++;
    else if (char === '}' && --depth === 0)
      return {
        start: match.index,
        end: index + 1,
        meta: asRecord(
          literal(parseExpression(source.slice(start, index + 1))),
        ),
      };
  }
  throw new Error('Space Lab: meta must be a literal object.');
}
function metadata(source: string, document: boolean): Record<string, unknown> {
  if (document) return documentMetadata(source)?.meta ?? {};
  const ast = parse(source, {
    sourceType: 'module',
    plugins: ['typescript', 'jsx'],
  });
  const declarations = new Map<string, Node | null | undefined>();
  for (const statement of ast.program.body) {
    const declaration =
      'declaration' in statement ? statement.declaration : statement;
    if (declaration?.type === 'VariableDeclaration') {
      for (const entry of declaration.declarations)
        if (entry.id.type === 'Identifier')
          declarations.set(entry.id.name, entry.init);
    }
  }
  const exported = ast.program.body.find(
    (node) => node.type === 'ExportDefaultDeclaration',
  );
  let node: Node | null | undefined = exported?.declaration;
  if (node?.type === 'Identifier') node = declarations.get(node.name);
  if (node?.type === 'CallExpression') node = node.arguments[0];
  return asRecord(literal(node));
}
function validText(value: unknown): value is Text {
  return typeof value === 'string' || isLocalizedText(value);
}
async function documentText(
  root: string,
  file: string,
  seen = new Set<string>(),
  locale?: string,
): Promise<string> {
  const canonical = await realpath(file);
  const location = relative(root, canonical);
  if (location.startsWith('..') || isAbsolute(location))
    throw new Error('Space Lab: imported document is outside project.');
  if (seen.has(canonical)) return '';
  seen.add(canonical);
  await projectPath(root, relative(root, file).replaceAll('\\', '/'));
  const source = await readFile(canonical, 'utf8');
  let searchable = source;
  if (locale) {
    const parsed = documentMetadata(source);
    if (parsed) {
      const selected = ['title', 'description', 'keywords'].map((key) => {
        const value = parsed.meta[key];
        const selectedValue =
          value && typeof value === 'object' && !Array.isArray(value)
            ? asRecord(value)[locale]
            : value;
        return typeof selectedValue === 'string'
          ? selectedValue
          : Array.isArray(selectedValue)
            ? selectedValue
                .filter((item): item is string => typeof item === 'string')
                .join(' ')
            : '';
      });
      searchable =
        source.slice(0, parsed.start) +
        source.slice(parsed.end) +
        '\n' +
        selected.join('\n');
    }
  }
  for (const match of source.matchAll(
    /^import\s+(?:(?:[^;'"\n]+|\{[^}]*\})\s+from\s+)?['"](\.[^'"]+\.mdx?)['"]/gm,
  )) {
    searchable +=
      '\n' +
      (await documentText(
        root,
        resolve(dirname(canonical), match[1]),
        seen,
        locale,
      ));
  }
  return searchable;
}
export async function discoverContent(
  root: string,
  config: SpaceLabConfig,
  diagnostics?: I18nDiagnostic[],
): Promise<ContentEntry[]> {
  const registry = createLocaleRegistry(config.i18n, config.defaultLocale);
  const rootReal = await realpath(root);
  const documentRoots = await loadDocumentRoots(root, config);
  const files = await glob(
    [
      ...config.content,
      ...documentRoots.map(([, path]) => `${path}/**/*.{md,mdx}`),
    ],
    {
      cwd: root,
      onlyFiles: true,
      unique: true,
      ignore: [
        '**/node_modules/**',
        '**/.git/**',
        '**/space-lab-static/**',
        '**/dist/**',
      ],
    },
  );
  const entries: ContentEntry[] = [];
  for (const file of files.sort()) {
    if (!/\.(md|mdx)$|\.examples\.(tsx?|jsx?)$/.test(file)) continue;
    try {
      const real = await realpath(resolve(root, file));
      const location = relative(rootReal, real);
      if (location.startsWith('..') || isAbsolute(location))
        throw new Error(`Space Lab: content is outside project: ${file}`);
      await projectPath(root, file);
      const source = await readFile(real, 'utf8');
      const document = ['.md', '.mdx'].includes(extname(file));
      const meta = metadata(source, document);
      const path = file.replaceAll('\\', '/');
      const documentRoot = document
        ? documentRoots.find(([, prefix]) => path.startsWith(prefix + '/'))
        : undefined;
      const documentPath = documentRoot
        ? path.slice(documentRoot[1].length + 1)
        : path;
      const versionLocale = documentRoot?.[0] ?? registry.sourceLocale;
      if (documentRoot && isLocalizedText(meta.title)) {
        meta.title = meta.title[versionLocale];
        if (typeof meta.title !== 'string' || !meta.title.trim())
          throw new I18nError('invalid_localized_title', { file });
      }
      if (documentRoot && isLocalizedText(meta.description))
        meta.description = meta.description[versionLocale];
      if (
        meta.title !== undefined &&
        (!validText(meta.title) ||
          !resolveText(
            meta.title,
            documentRoot ? versionLocale : registry.defaultLocale,
            registry,
          ).value.trim())
      )
        throw new I18nError('invalid_localized_title', { file });
      const stem = documentPath.replace(
        /\.(md|mdx)$|\.examples\.(tsx?|jsx?)$/,
        '',
      );
      const slug = stem
        .toLowerCase()
        .replace(/[^\p{L}\p{N}/_-]+/gu, '-')
        .replaceAll('/', '--');
      const id =
        document && typeof meta.id === 'string'
          ? meta.id
          : `${document ? 'doc' : 'examples'}:${slug}`;
      if (
        document &&
        Object.hasOwn(meta, 'id') &&
        (typeof meta.id !== 'string' || !/^doc:[\p{L}\p{N}_-]+$/u.test(meta.id))
      )
        throw new Error(`Space Lab: invalid document ID in ${path}`);
      if (
        document &&
        meta.status !== undefined &&
        meta.status !== 'complete' &&
        meta.status !== 'draft'
      )
        throw new Error(`Space Lab: invalid document status in ${path}`);
      if (
        document &&
        meta.locale !== undefined &&
        meta.locale !== versionLocale
      )
        throw new Error(`Space Lab: document locale mismatch in ${path}`);
      const pathOwner = documentRoot
        ? entries.find(
            (entry) =>
              entry.kind === 'document' && entry.documentPath === documentPath,
          )
        : undefined;
      if (pathOwner && pathOwner.id !== id)
        throw new Error(`Space Lab: document path to ID mismatch in ${path}`);
      if (
        meta.aliases !== undefined &&
        (!Array.isArray(meta.aliases) ||
          meta.aliases.some(
            (alias: unknown) => typeof alias !== 'string' || !alias.trim(),
          ))
      ) {
        throw new Error(`Space Lab: invalid aliases in ${path}`);
      }
      const aliases = (Array.isArray(meta.aliases) ? meta.aliases : [])
        .filter((alias): alias is string => typeof alias === 'string')
        .map((alias) =>
          alias.includes(':')
            ? alias
            : `${document ? 'doc' : 'examples'}:${alias}`,
        );
      if (
        aliases.some(
          (alias) =>
            !alias.startsWith(document ? 'doc:' : 'examples:') ||
            !/^[\p{L}\p{N}_-]+$/u.test(alias.split(':')[1]) ||
            alias.split(':').length !== 2,
        )
      ) {
        throw new Error(`Space Lab: invalid aliases in ${path}`);
      }
      const conflict = entries.find((entry) => entry.id === id);
      if (conflict && Boolean(conflict.localized) !== Boolean(documentRoot))
        throw new Error(
          `Space Lab: mixing rooted and legacy document identity: ${id} (${conflict.file}, ${path})`,
        );
      if (conflict && documentRoot) {
        if (
          conflict.documentPath?.replace(/\.mdx?$/, '') !==
          documentPath.replace(/\.mdx?$/, '')
        )
          throw new Error(
            `Space Lab: document ID to path mismatch: ${id} (${path})`,
          );
        if (conflict.versions?.[versionLocale])
          throw new Error(
            `Space Lab: duplicate document version: ${id} (${path})`,
          );
        if (conflict.documentPath !== documentPath)
          throw new Error(
            `Space Lab: document ID to path mismatch: ${id} (${path})`,
          );
        if (conflict.order !== meta.order || conflict.group !== meta.group)
          throw new Error(
            `Space Lab: document structural metadata mismatch: ${id} (${path})`,
          );
      }
      if (conflict && !documentRoot)
        throw new Error(
          `Space Lab: duplicate page ID: ${id} (${conflict.file}, ${path})`,
        );
      const heading = /^#\s+(.+)$/m.exec(source)?.[1];
      const entry: ContentEntry = {
        id,
        file: path,
        kind: document ? 'document' : 'examples',
        ...(aliases.length ? { aliases: [...new Set(aliases)] } : {}),
        title: validText(meta.title)
          ? meta.title
          : `${document ? 'Guide' : 'Components'}/${String(heading ?? stem.split('/').pop())}`,
        description: validText(meta.description) ? meta.description : undefined,
        ...(typeof meta.order === 'number' && Number.isFinite(meta.order)
          ? { order: meta.order }
          : {}),
        search: document
          ? [
              diagnostics
                ? source
                : await documentText(
                    rootReal,
                    real,
                    new Set(),
                    documentRoot ? versionLocale : undefined,
                  ),
              config.documentSearchText?.(path, {
                locale: versionLocale,
                logicalId: id,
              }),
            ]
              .filter(Boolean)
              .join('\n')
          : source,
        ...(document ? { source } : {}),
        ...(document
          ? {}
          : {
              examples: Object.keys(asRecord(meta.examples)),
              exampleNames: Object.fromEntries(
                Object.entries(asRecord(meta.examples)).flatMap(
                  ([key, example]) => {
                    const name = asRecord(example).name;
                    return validText(name) ? [[key, name]] : [];
                  },
                ),
              ),
            }),
      };
      if (document) {
        entry.documentPath = documentPath;
        entry.localized = !!documentRoot;
        entry.group = typeof meta.group === 'string' ? meta.group : undefined;
        entry.versions = {
          [versionLocale]: {
            file: entry.file,
            title: entry.title,
            description: entry.description,
            search: entry.search,
            source,
            status: meta.status === 'draft' ? 'draft' : 'complete',
          },
        };
      }
      if (conflict && documentRoot) {
        conflict.aliases = [
          ...new Set([...(conflict.aliases ?? []), ...aliases]),
        ];
        Object.assign(conflict.versions ?? {}, entry.versions);
        if (versionLocale === registry.sourceLocale) {
          Object.assign(conflict, {
            file: entry.file,
            title: entry.title,
            description: entry.description,
            search: entry.search,
            source,
          });
        }
      } else entries.push(entry);
    } catch (error) {
      if (!diagnostics) throw error;
      const locale =
        documentRoots.find(([, prefix]) =>
          file.startsWith(prefix + '/'),
        )?.[0] ?? registry.sourceLocale;
      diagnostics.push({
        ...diagnosticFromError(
          error,
          error instanceof SyntaxError ? 'invalid_mdx' : 'invalid_document',
        ),
        file,
        locale,
      });
    }
  }
  await applySharedDocuments(root, config, entries, diagnostics);
  if (!entries.length)
    throw new Error(
      'Space Lab: no .md, .mdx or .examples files match content.',
    );
  for (const entry of entries)
    if (entry.kind === 'document' && !entry.versions?.[registry.sourceLocale]) {
      if (diagnostics)
        diagnostics.push({
          severity: 'error',
          code: 'missing_source_document',
          file: entry.file,
          key: entry.id,
          locale: registry.sourceLocale,
        });
      else
        throw new Error(
          `Space Lab: missing source document version: ${entry.id}`,
        );
    }
  const routes = new Map(entries.map((entry) => [entry.id, entry]));
  for (const entry of entries)
    for (const alias of entry.aliases ?? []) {
      const owner = routes.get(alias);
      if (owner && owner !== entry) {
        if (diagnostics)
          diagnostics.push({
            severity: 'error',
            code: 'duplicate_route_alias',
            file: entry.file,
            key: alias,
          });
        else
          throw new Error(
            `Space Lab: duplicate route alias: ${alias} (${owner.file}, ${entry.file})`,
          );
      }
      routes.set(alias, entry);
    }
  const api = extractApi(
    root,
    entries
      .filter((entry) => entry.kind === 'examples')
      .map((entry) => entry.file),
  );
  for (const entry of entries)
    if (entry.kind === 'examples') {
      const path = resolve(root, entry.file).replaceAll('\\', '/');
      entry.api = api.get(path) ?? [];
      entry.subcomponentApi = Object.fromEntries(
        [...api]
          .filter(([key]) => key.startsWith(path + '#'))
          .map(([key, props]) => [key.slice(path.length + 1), props]),
      );
    }
  if (config.home && !resolveRoute(entries, config.home)) {
    const choices = entries.filter(
      (entry) => entry.id.split(':')[1] === config.home,
    );
    if (choices.length)
      throw new Error(
        `Space Lab: ambiguous home page: ${config.home}; use ${choices.map((entry) => entry.id).join(' or ')}`,
      );
    throw new Error(`Space Lab: unknown home page: ${config.home}`);
  }
  return entries.sort(
    (first, second) => (first.order ?? 1000) - (second.order ?? 1000),
  );
}
