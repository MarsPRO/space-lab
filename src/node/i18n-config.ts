import { readFile, realpath, readdir, stat } from 'node:fs/promises';
import { resolve, relative, isAbsolute } from 'node:path';
import type { SpaceLabConfig } from '../index.js';
import { createTranslator } from '../i18n/translator.js';
import type { CatalogResources, MessageSchema } from '../i18n/translator.js';
import {
  createLocaleRegistry,
  resolveSiteLocale,
  I18nError,
} from '../i18n/registry.js';
import type { LocaleRegistryInput } from '../i18n/registry.js';
import { isRecord } from '../runtime/data.js';
import { parseExpression } from '@babel/parser';
import { diagnosticFromError } from '../i18n/diagnostics.js';
import type { I18nDiagnostic } from '../i18n/diagnostics.js';
export interface I18nConfig extends LocaleRegistryInput {
  catalogs?: Record<string, Record<string, string>>;
  schemas?: MessageSchema;
  /** Project-relative roots whose matching relative paths identify document versions. */
  documents?: Record<string, string>;
  /** One MDX tree with flat, per-page JSON catalogs; missing translations fall back as a whole page. */
  sharedDocuments?: { root: string; catalogs: Record<string, string> };
}
export async function projectPath(
  root: string,
  path: string,
  directory = false,
) {
  if (
    typeof path !== 'string' ||
    !path ||
    path.includes('\\') ||
    isAbsolute(path) ||
    /^[A-Za-z]:/.test(path) ||
    path
      .split('/')
      .some((segment) => !segment || segment === '.' || segment === '..')
  )
    throw new I18nError('invalid_catalog_path', { path: JSON.stringify(path) });
  if (
    path
      .split('/')
      .some((segment) =>
        /^\.env(?:\.|$)|^(?:credentials|secrets?)(?:\.|$)/i.test(segment),
      )
  )
    throw new I18nError('protected_project_path');
  let current = root;
  for (const segment of path.split('/')) {
    if (!(await readdir(current)).includes(segment))
      throw new I18nError('catalog_path_case_or_missing', { path });
    current = resolve(current, segment);
    const physical = relative(await realpath(root), await realpath(current));
    if (physical.startsWith('..') || isAbsolute(physical))
      throw new I18nError('catalog_outside_project', { path });
    if (
      physical
        .split(/[\\/]/)
        .some((segment) =>
          /^\.env(?:\.|$)|^(?:credentials|secrets?)(?:\.|$)/i.test(segment),
        )
    )
      throw new I18nError('protected_project_path', { path });
  }
  if ((await stat(current)).isDirectory() !== directory)
    throw new I18nError('invalid_catalog_path_type', { path });
  return current;
}
export async function loadDocumentRoots(root: string, config: SpaceLabConfig) {
  const registry = createLocaleRegistry(config.i18n, config.defaultLocale);
  const roots: [string, string][] = [];
  if (config.i18n?.sharedDocuments) {
    if (Object.keys(config.i18n.documents ?? {}).length)
      throw new I18nError('mixed_document_models');
    const shared = config.i18n.sharedDocuments;
    await projectPath(root, shared.root, true);
    const tags = new Set<string>();
    for (const [raw, path] of Object.entries(shared.catalogs)) {
      const tag = resolveSiteLocale(raw, registry);
      if (tags.has(tag))
        throw new I18nError('duplicate_catalog_locale', { locale: tag });
      tags.add(tag);
      await projectPath(root, path, true);
    }
    if (!tags.has(registry.sourceLocale))
      throw new I18nError('missing_source_catalog');
    return [[registry.sourceLocale, shared.root]] satisfies [string, string][];
  }
  for (const [raw, path] of Object.entries(config.i18n?.documents ?? {})) {
    const tag = resolveSiteLocale(raw, registry);
    await projectPath(root, path, true);
    if (
      roots.some(
        ([locale, prefix]) =>
          locale === tag ||
          path === prefix ||
          path.startsWith(prefix + '/') ||
          prefix.startsWith(path + '/'),
      )
    )
      throw new I18nError('overlapping_document_roots', { path });
    roots.push([tag, path]);
  }
  return roots;
}
export async function loadSiteI18n(
  root: string,
  config: SpaceLabConfig,
  diagnostics?: I18nDiagnostic[],
) {
  const registry = createLocaleRegistry(config.i18n, config.defaultLocale);
  const schema = config.i18n?.schemas ?? {};
  const resources: CatalogResources = {};
  for (const [namespace, catalogs] of Object.entries(
    config.i18n?.catalogs ?? {},
  )) {
    if (['__proto__', 'prototype', 'constructor'].includes(namespace))
      throw new I18nError('reserved_message_name', { name: namespace });
    resources[namespace] = {};
    for (const [raw, path] of Object.entries(catalogs)) {
      let tag = raw;
      try {
        tag = resolveSiteLocale(raw, registry);
        if (Object.hasOwn(resources[namespace], tag))
          throw new I18nError('duplicate_catalog_locale', { locale: tag });
        const source = await readFile(await projectPath(root, path), 'utf8');
        const data: unknown = JSON.parse(source);
        if (!isRecord(data))
          throw new I18nError('invalid_catalog', { namespace, locale: tag });
        for (const [key, value] of Object.entries(data)) {
          if (typeof value === 'string') continue;
          if (!diagnostics)
            throw new I18nError('invalid_catalog', { namespace, locale: tag });
          diagnostics.push({
            severity: 'error',
            code: 'invalid_message_value',
            namespace,
            locale: tag,
            file: path,
            key,
          });
        }
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
              throw new I18nError('duplicate_message_key', {
                namespace,
                locale: tag,
                key,
              });
            keys.add(key);
          }
        resources[namespace][tag] = Object.fromEntries(
          Object.entries(data).filter(
            (entry): entry is [string, string] => typeof entry[1] === 'string',
          ),
        );
      } catch (error) {
        if (!diagnostics) throw error;
        diagnostics.push({
          ...diagnosticFromError(
            error,
            error instanceof SyntaxError
              ? 'invalid_json'
              : 'catalog_load_error',
          ),
          namespace,
          locale: tag,
          file: path,
        });
      }
    }
  }
  if (!diagnostics) {
    await loadDocumentRoots(root, config);
    await createTranslator({ registry, schema, resources });
  }
  return { registry, schema, resources };
}
