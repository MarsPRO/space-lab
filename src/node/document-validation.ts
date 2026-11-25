import { readFile } from 'node:fs/promises';
import { posix } from 'node:path';

import mdx from '@mdx-js/rollup';
import remarkGfm from 'remark-gfm';
import { parse, parseExpression } from '@babel/parser';
import type { ContentEntry } from './content.js';
import type { LocaleRegistry } from '../i18n/registry.js';
import type { I18nDiagnostic } from '../i18n/diagnostics.js';
import { projectPath } from './i18n-config.js';
import { asRecord } from '../runtime/data.js';
import {
  resolveDocument,
  resolveDocumentLink,
  documentCompleteness,
} from '../runtime/documents.js';
import { resolveRoute } from '../runtime/routes.js';

interface StaticLink {
  value: string;
  kind: 'link' | 'image' | 'page';
  line?: number;
  column?: number;
}
interface ParsedDocument {
  anchors: Set<string>;
  links: StaticLink[];
  imports: string[];
  diagnostics: I18nDiagnostic[];
}
function children(node: Record<string, unknown>): unknown[] {
  return Array.isArray(node.children) ? node.children : [];
}
function position(node: Record<string, unknown>) {
  const start = asRecord(asRecord(node.position).start);
  return {
    ...(typeof start.line === 'number' ? { line: start.line } : {}),
    ...(typeof start.column === 'number' ? { column: start.column } : {}),
  };
}
function literalAttribute(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  const expression = asRecord(value).value;
  if (typeof expression !== 'string') return undefined;
  try {
    const node = parseExpression(expression);
    if (node.type === 'StringLiteral') return node.value;
    if (node.type === 'TemplateLiteral' && node.expressions.length === 0)
      return node.quasis[0].value.cooked ?? undefined;
  } catch {
    /* The compiler reports expression syntax errors. */
  }
  return undefined;
}
async function parseDocument(
  source: string,
  file: string,
): Promise<ParsedDocument> {
  const result: ParsedDocument = {
    anchors: new Set(),
    links: [],
    imports: [],
    diagnostics: [],
  };
  const definitions = new Map<string, string>();
  const references: {
    node: Record<string, unknown>;
    kind: 'link' | 'image';
  }[] = [];
  const dynamicImports = (
    value: unknown,
    location: ReturnType<typeof position>,
  ): void => {
    if (Array.isArray(value)) {
      for (const item of value) dynamicImports(item, location);
      return;
    }
    const node = asRecord(value);
    if (node.type === 'ImportExpression') {
      const source = asRecord(node.source);
      const quasis = Array.isArray(source.quasis) ? source.quasis : [];
      const target =
        typeof source.value === 'string'
          ? source.value
          : source.type === 'TemplateLiteral' &&
              Array.isArray(source.expressions) &&
              source.expressions.length === 0
            ? asRecord(asRecord(quasis[0]).value).cooked
            : undefined;
      if (typeof target === 'string') result.imports.push(target);
      else
        result.diagnostics.push({
          severity: 'warning',
          code: 'dynamic_import_unchecked',
          ...location,
        });
    }
    for (const child of Object.values(node))
      if (child && typeof child === 'object') dynamicImports(child, location);
  };
  const visit = (value: unknown): void => {
    const node = asRecord(value);
    const location = position(node);
    if (node.type === 'code' || node.type === 'inlineCode') return;
    dynamicImports(asRecord(node.data).estree, location);
    if (
      node.type === 'definition' &&
      typeof node.identifier === 'string' &&
      typeof node.url === 'string'
    )
      definitions.set(node.identifier, node.url);
    if (node.type === 'linkReference' || node.type === 'imageReference')
      references.push({
        node,
        kind: node.type === 'imageReference' ? 'image' : 'link',
      });
    if (
      (node.type === 'link' || node.type === 'image') &&
      typeof node.url === 'string'
    )
      result.links.push({ value: node.url, kind: node.type, ...location });
    if (node.type === 'mdxjsEsm' && typeof node.value === 'string') {
      const ast = parse(node.value, { sourceType: 'module' });
      for (const statement of ast.program.body) {
        if (
          statement.type === 'ImportDeclaration' ||
          statement.type === 'ExportNamedDeclaration' ||
          statement.type === 'ExportAllDeclaration'
        ) {
          if (statement.source) result.imports.push(statement.source.value);
        }
      }
    }
    if (
      node.type === 'mdxJsxFlowElement' ||
      node.type === 'mdxJsxTextElement'
    ) {
      const attributes = Array.isArray(node.attributes)
        ? node.attributes.map(asRecord)
        : [];
      for (const attribute of attributes) {
        dynamicImports(
          asRecord(asRecord(attribute.value).data).estree,
          position(attribute),
        );
        dynamicImports(asRecord(attribute.data).estree, position(attribute));
        const name = attribute.name;
        const link =
          (node.name === 'a' && name === 'href') ||
          ((node.name === 'img' || node.name === 'source') && name === 'src') ||
          (node.name === 'DocLink' && name === 'page');
        if (!link && name !== 'id' && !(node.name === 'a' && name === 'name'))
          continue;
        const text = literalAttribute(attribute.value);
        if (text === undefined) {
          result.diagnostics.push({
            severity: 'warning',
            code: link ? 'dynamic_link_unchecked' : 'dynamic_anchor_unchecked',
            ...position(attribute),
          });
        } else if (link)
          result.links.push({
            value: text,
            kind: name === 'page' ? 'page' : name === 'src' ? 'image' : 'link',
            ...position(attribute),
          });
        else {
          if (result.anchors.has(text))
            result.diagnostics.push({
              severity: 'error',
              code: 'duplicate_anchor',
              target: text,
              ...position(attribute),
            });
          result.anchors.add(text);
        }
      }
      if (
        attributes.some(
          (attribute) => attribute.type === 'mdxJsxExpressionAttribute',
        ) &&
        ['a', 'img', 'DocLink'].includes(String(node.name))
      )
        result.diagnostics.push({
          severity: 'warning',
          code: 'dynamic_link_unchecked',
          ...location,
        });
    }
    for (const child of children(node)) visit(child);
  };
  const collect = () => (tree: unknown) => {
    visit(tree);
  };
  try {
    // Use the installed direct dependency's transform hook: compile only, never evaluate/import its output.
    await mdx({ remarkPlugins: [remarkGfm, collect] }).transform(source, file);
    for (const { node, kind } of references) {
      const url = definitions.get(String(node.identifier));
      if (url !== undefined)
        result.links.push({ value: url, kind, ...position(node) });
      else
        result.diagnostics.push({
          severity: 'error',
          code: 'broken_link_reference',
          ...position(node),
        });
    }
  } catch (error) {
    const data = asRecord(error);
    result.diagnostics.push({
      severity: 'error',
      code: 'invalid_mdx',
      ...(typeof data.line === 'number' ? { line: data.line } : {}),
      ...(typeof data.column === 'number' ? { column: data.column } : {}),
    });
  }
  return result;
}

/** Resolve exact-case local files without opening code, raw snippets or secret files. */
function localReference(from: string, target: string) {
  const requested = decodeURIComponent(target.split(/[?#]/)[0]);
  if (requested.includes('\\')) throw new Error('Invalid local path.');
  const path = requested.startsWith('/')
    ? posix.normalize(requested.slice(1))
    : posix.normalize(posix.join(posix.dirname(from), requested));
  if (path === '..' || path.startsWith('../'))
    throw new Error('Path outside project.');
  if (
    path
      .split('/')
      .some((segment) =>
        /^\.env(?:\.|$)|^(?:credentials|secrets?)(?:\.|$)/i.test(segment),
      )
  )
    throw new Error('Protected path.');
  return path;
}
async function localFile(
  root: string,
  from: string,
  target: string,
  imports = false,
) {
  const path = localReference(from, target);
  const candidates = imports
    ? [
        path,
        ...[
          '.tsx',
          '.ts',
          '.jsx',
          '.js',
          '.mjs',
          '.mdx',
          '.md',
          '.json',
          '.css',
        ].map((extension) => path + extension),
        ...['.tsx', '.ts', '.jsx', '.js', '.mjs'].map(
          (extension) => path + '/index' + extension,
        ),
      ]
    : [path];
  for (const candidate of candidates) {
    try {
      return { file: candidate, absolute: await projectPath(root, candidate) };
    } catch {
      /* Try only the finite documented extension/index resolution list. */
    }
  }
  throw new Error('Invalid local path.');
}

export async function validateDocuments(
  root: string,
  entries: readonly ContentEntry[],
  registry: LocaleRegistry,
): Promise<I18nDiagnostic[]> {
  const diagnostics = documentCompleteness(entries, registry);
  const cache = new Map<string, ParsedDocument>();
  const get = async (file: string) => {
    let parsed = cache.get(file);
    if (!parsed) {
      const absolute = await projectPath(root, file);
      parsed = await parseDocument(await readFile(absolute, 'utf8'), file);
      cache.set(file, parsed);
    }
    return parsed;
  };
  const anchorsFor = async (
    file: string,
    seen = new Set<string>(),
  ): Promise<Set<string>> => {
    if (seen.has(file)) return new Set();
    seen.add(file);
    const parsed = await get(file);
    const anchors = new Set(parsed.anchors);
    for (const target of parsed.imports) {
      if (!target.startsWith('.') || /[?&]raw(?:&|$)/.test(target)) continue;
      const imported = await localFile(root, file, target, true);
      if (/\.mdx?$/.test(imported.file))
        for (const anchor of await anchorsFor(imported.file, seen))
          anchors.add(anchor);
    }
    return anchors;
  };
  for (const entry of entries.filter((item) => item.kind === 'document')) {
    for (const [locale, version] of Object.entries(entry.versions ?? {})) {
      const anchors = new Set<string>();
      const links: { link: StaticLink; file: string }[] = [];
      const seen = new Set<string>();
      const visit = async (file: string, stack: Set<string>): Promise<void> => {
        if (stack.has(file)) {
          diagnostics.push({
            severity: 'error',
            code: 'document_import_cycle',
            file,
            locale,
            key: entry.id,
          });
          return;
        }
        if (seen.has(file)) return;
        seen.add(file);
        const parsed = await get(file);
        diagnostics.push(
          ...parsed.diagnostics.map((issue) => ({
            ...issue,
            file,
            locale,
            key: entry.id,
          })),
        );
        for (const anchor of parsed.anchors) anchors.add(anchor);
        links.push(...parsed.links.map((link) => ({ link, file })));
        for (const target of parsed.imports) {
          if (
            !target.startsWith('.') &&
            !target.startsWith('/') &&
            !target.includes('\\') &&
            !/^[a-z]:|^file:/i.test(target)
          )
            continue;
          try {
            const imported = await localFile(root, file, target, true);
            if (/\.mdx?$/.test(imported.file) && !/[?&]raw(?:&|$)/.test(target))
              await visit(imported.file, new Set([...stack, file]));
          } catch {
            diagnostics.push({
              severity: 'error',
              code: 'invalid_import_path',
              file,
              locale,
              key: entry.id,
              target,
            });
          }
        }
      };
      try {
        await visit(version.file, new Set());
      } catch {
        diagnostics.push({
          severity: 'error',
          code: 'document_load_error',
          file: version.file,
          locale,
          key: entry.id,
        });
      }
      for (const { link, file } of links) {
        const base = {
          locale,
          file,
          key: entry.id,
          target: link.value,
          line: link.line,
          column: link.column,
        };
        if (/^(?:javascript|vbscript):/i.test(link.value)) {
          diagnostics.push({
            ...base,
            severity: 'error',
            code: 'unsafe_link_scheme',
          });
          continue;
        }
        if (
          link.kind !== 'page' &&
          /^[a-z][a-z\d+.-]*:|^\/\//i.test(link.value) &&
          !link.value.startsWith('doc:') &&
          !link.value.startsWith('examples:')
        )
          continue;
        try {
          if (link.kind === 'image') {
            await localFile(root, file, link.value);
            continue;
          }
          let destination: ContentEntry | undefined;
          let anchor = '';
          let targetLocale = locale;
          if (link.kind !== 'page') localReference(file, link.value);
          const url = new URL(link.value, 'https://space.invalid/' + file);
          const state = new URLSearchParams(url.hash.slice(1));
          if (link.kind === 'page') {
            // The site's authored DocLink uses this established route convention (not a new public component API).
            destination = resolveRoute(
              entries,
              link.value.startsWith('examples:')
                ? link.value
                : `doc:docs--guide--${link.value}`,
            );
          } else if (state.has('page')) {
            destination = resolveRoute(entries, state.get('page'));
            const requestedLocale = state.get('locale');
            if (
              requestedLocale &&
              !Object.hasOwn(registry.locales, requestedLocale)
            )
              throw new Error('Unknown link locale.');
            targetLocale = requestedLocale ?? locale;
            if (
              state.has('example') &&
              !destination?.examples?.includes(state.get('example') ?? '')
            )
              throw new Error('Unknown example.');
            anchor = state.get('anchor') ?? '';
          } else {
            const resolved = resolveDocumentLink(
              entries,
              {
                ...entry,
                file,
                versions: { ...entry.versions, [locale]: { ...version, file } },
              },
              locale,
              link.value,
              registry,
            );
            destination = resolved?.entry;
            anchor = resolved?.anchor ?? '';
          }
          if (!destination) {
            if (link.kind === 'page' || state.has('page'))
              throw new Error('Unknown route.');
            await localFile(root, file, link.value);
          } else if (anchor) {
            const target = resolveDocument(destination, targetLocale, registry);
            const targets =
              destination === entry && target.file === version.file
                ? anchors
                : await anchorsFor(target.file);
            if (!targets.has(anchor)) {
              diagnostics.push({
                ...base,
                severity: 'error',
                code: 'broken_anchor',
              });
              continue;
            }
          }
        } catch {
          diagnostics.push({ ...base, severity: 'error', code: 'broken_link' });
        }
      }
    }
  }
  return diagnostics;
}
