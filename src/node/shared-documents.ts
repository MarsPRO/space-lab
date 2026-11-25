import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseExpression } from '@babel/parser';
import type { ContentEntry, DocumentVersion } from './content.js';
import type { SpaceLabConfig } from '../index.js';
import type { I18nDiagnostic } from '../i18n/diagnostics.js';
import { diagnosticFromError } from '../i18n/diagnostics.js';
import { projectPath } from './i18n-config.js';
import {
  createLocaleRegistry,
  resolveSiteLocale,
  I18nError,
} from '../i18n/registry.js';
import { isRecord } from '../runtime/data.js';

async function catalog(
  root: string,
  file: string,
): Promise<Record<string, string> | undefined> {
  try {
    await stat(resolve(root, file));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
  const source = await readFile(await projectPath(root, file), 'utf8');
  const data: unknown = JSON.parse(source);
  if (!isRecord(data))
    throw new I18nError('invalid_document_catalog', { file });
  const ast = parseExpression(source);
  const keys = new Set<string>();
  if (ast.type === 'ObjectExpression')
    for (const property of ast.properties) {
      if (
        property.type !== 'ObjectProperty' ||
        property.key.type !== 'StringLiteral'
      )
        continue;
      const key = property.key.value;
      if (keys.has(key))
        throw new I18nError('duplicate_message_key', { file, key });
      keys.add(key);
    }
  const messages: Record<string, string> = {};
  for (const [key, value] of Object.entries(data)) {
    if (['__proto__', 'prototype', 'constructor'].includes(key))
      throw new I18nError('reserved_message_name', { file, key });
    if (typeof value !== 'string')
      throw new I18nError('invalid_message_value', { file, key });
    messages[key] = value;
  }
  return messages;
}

export async function applySharedDocuments(
  root: string,
  config: SpaceLabConfig,
  entries: ContentEntry[],
  diagnostics?: I18nDiagnostic[],
) {
  const shared = config.i18n?.sharedDocuments;
  if (!shared) return;
  const registry = createLocaleRegistry(config.i18n, config.defaultLocale);
  const roots = Object.fromEntries(
    Object.entries(shared.catalogs).map(([tag, path]) => [
      resolveSiteLocale(tag, registry),
      path,
    ]),
  );
  for (const entry of entries.filter(
    (item) =>
      item.kind === 'document' && item.file.startsWith(shared.root + '/'),
  )) {
    const stem = entry.documentPath?.replace(/\.mdx?$/, '');
    if (!stem) continue;
    const sourceFile = `${roots[registry.sourceLocale]}/${stem}.json`;
    const status =
      entry.versions?.[registry.sourceLocale]?.status ?? 'complete';
    entry.shared = true;
    entry.versions = {};
    entry.catalogFiles = {};
    entry.translationDiagnostics = [];
    try {
      const source = await catalog(root, sourceFile);
      if (!source)
        throw new I18nError('missing_source_catalog', { file: sourceFile });
      if (
        !Object.hasOwn(source, 'title') ||
        !source.title.trim() ||
        Object.values(source).some((value) => !value.trim())
      )
        throw new I18nError('missing_source_catalog', { file: sourceFile });
      const versions: Record<string, DocumentVersion> = {};
      for (const tag of Object.keys(registry.locales)) {
        const file = roots[tag] ? `${roots[tag]}/${stem}.json` : undefined;
        try {
          const messages =
            tag === registry.sourceLocale
              ? source
              : file
                ? await catalog(root, file)
                : undefined;
          if (messages && file) entry.catalogFiles[tag] = file;
          const extra = Object.keys(messages ?? {}).find(
            (key) => !Object.hasOwn(source, key),
          );
          if (extra)
            throw new I18nError('unknown_message_key', {
              file: file ?? entry.file,
              locale: tag,
              key: extra,
            });
          const missing = Object.keys(source).filter(
            (key) => !messages?.[key]?.trim(),
          );
          if (missing.length) {
            entry.translationDiagnostics.push({
              severity: 'incomplete',
              code: messages
                ? 'incomplete_document_catalog'
                : 'missing_document_catalog',
              locale: tag,
              file: file ?? entry.file,
              key: entry.id,
              missing,
            });
            continue;
          }
          if (!messages || !file) continue;
          versions[tag] = {
            file: entry.file,
            catalog: file,
            title: messages.title,
            description: messages.description,
            search: Object.values(messages).join('\n'),
            source: entry.source,
            status,
          };
          if (status === 'draft')
            entry.translationDiagnostics.push({
              severity: 'incomplete',
              code: 'draft_document',
              locale: tag,
              file: entry.file,
              key: entry.id,
            });
        } catch (error) {
          if (!diagnostics) throw error;
          entry.translationDiagnostics.push({
            ...diagnosticFromError(error, 'invalid_document_catalog'),
            locale: tag,
            file,
            key: entry.id,
          });
        }
      }
      entry.versions = versions;
      Object.assign(entry, versions[registry.sourceLocale]);
    } catch (error) {
      if (!diagnostics) throw error;
      entry.translationDiagnostics.push({
        ...diagnosticFromError(error, 'invalid_document_catalog'),
        locale: registry.sourceLocale,
        file: sourceFile,
        key: entry.id,
      });
    }
  }
}
