import type { SpaceLabConfig } from '../index.js';
import { discoverContent } from './content.js';
import type { ContentEntry } from './content.js';
import { loadSiteI18n } from './i18n-config.js';
import {
  effectiveCatalog,
  engineSchema,
  familyKeys,
  validateCatalog,
  validateSchema,
} from '../i18n/translator.js';
import { validateDocuments } from './document-validation.js';
import { diagnosticFromError } from '../i18n/diagnostics.js';
import type { I18nDiagnostic } from '../i18n/diagnostics.js';
import { canonicalLocale } from '../i18n/registry.js';

export async function checkI18n(
  root: string,
  config: SpaceLabConfig,
  strict = false,
) {
  const diagnostics: I18nDiagnostic[] = [];
  const { registry, schema, resources } = await loadSiteI18n(
    root,
    config,
    diagnostics,
  );
  const definitionsByNamespace = { ...schema, ...engineSchema };
  try {
    if (Object.hasOwn(schema, 'spaceLab'))
      diagnostics.push({ severity: 'error', code: 'reserved_namespace' });
    validateSchema(definitionsByNamespace);
  } catch (error) {
    diagnostics.push(diagnosticFromError(error, 'invalid_schema'));
    return { ok: false, locales: [], diagnostics };
  }
  for (const namespace of Object.keys(resources))
    if (!Object.hasOwn(definitionsByNamespace, namespace))
      diagnostics.push({
        severity: 'error',
        code: 'unknown_namespace',
        namespace,
      });
  let entries: ContentEntry[] = [];
  try {
    entries = await discoverContent(
      root,
      { ...config, documentSearchText: undefined },
      diagnostics,
    );
  } catch (error) {
    diagnostics.push(diagnosticFromError(error, 'invalid_documents'));
  }
  diagnostics.push(...(await validateDocuments(root, entries, registry)));
  const documents = entries.filter((entry) => entry.kind === 'document');
  const locales = Object.entries(registry.locales).map(
    ([locale, definition]) => ({
      locale,
      name: definition.name,
      dir: definition.dir,
      status: definition.status,
      catalogs: Object.entries(definitionsByNamespace)
        .sort(([left], [right]) => left.localeCompare(right, 'en'))
        .map(([namespace, definitions]) => {
          const file =
            Object.entries(config.i18n?.catalogs?.[namespace] ?? {}).find(
              ([tag]) => {
                try {
                  return canonicalLocale(tag) === locale;
                } catch {
                  return false;
                }
              },
            )?.[1] ?? 'space-lab.config.mjs';
          const overlay = Object.hasOwn(resources, namespace)
            ? resources[namespace][locale]
            : undefined;
          for (const [key, value] of Object.entries(overlay ?? {})) {
            try {
              validateCatalog({ [key]: value }, definitions, locale);
            } catch (error) {
              diagnostics.push({
                ...diagnosticFromError(error, 'invalid_catalog'),
                locale,
                namespace,
                key,
                file,
              });
            }
          }
          const catalog = effectiveCatalog(namespace, locale, overlay);
          const missing: string[] = [];
          let complete = 0;
          for (const [key, message] of Object.entries(definitions)) {
            const absent = familyKeys(key, message, locale).filter(
              (member) =>
                !Object.hasOwn(catalog, member) || !catalog[member].trim(),
            );
            if (absent.length) {
              missing.push(...absent);
              diagnostics.push({
                severity:
                  definition.status === 'complete' ||
                  (namespace !== 'spaceLab' &&
                    locale === registry.fallbackLocale)
                    ? 'error'
                    : 'incomplete',
                code: 'incomplete_catalog',
                locale,
                namespace,
                key,
                file,
                missing: absent,
              });
            } else complete++;
          }
          return {
            namespace,
            families: Object.keys(definitions).length,
            complete,
            keys: Object.keys(catalog).length,
            missing,
          };
        }),
      documents: {
        expected: documents.length,
        present: documents.filter((entry) =>
          entry.shared
            ? entry.catalogFiles?.[locale]
            : entry.versions?.[locale],
        ).length,
        complete: documents.filter(
          (entry) => entry.versions?.[locale]?.status === 'complete',
        ).length,
      },
    }),
  );
  return {
    ok: !diagnostics.some(
      (issue) =>
        issue.severity === 'error' ||
        (strict && issue.severity === 'incomplete'),
    ),
    locales,
    diagnostics,
  };
}
