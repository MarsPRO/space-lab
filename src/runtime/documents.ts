import type { ContentEntry } from '../node/content.js';
import type { LocaleRegistry } from '../i18n/registry.js';
import type { I18nDiagnostic } from '../i18n/diagnostics.js';

/** Completeness is physical version state, not resolveDocument's display fallback. */
export function documentCompleteness(
  entries: readonly ContentEntry[],
  registry: LocaleRegistry,
): I18nDiagnostic[] {
  const diagnostics: I18nDiagnostic[] = [];
  for (const entry of entries.filter((item) => item.kind === 'document')) {
    if (entry.shared) {
      diagnostics.push(...(entry.translationDiagnostics ?? []));
      continue;
    }
    for (const [locale, definition] of Object.entries(registry.locales)) {
      const version = entry.versions?.[locale];
      if (version?.status === 'complete') continue;
      const legacy = !entry.localized && locale !== registry.sourceLocale;
      diagnostics.push({
        severity: legacy
          ? 'warning'
          : definition.status === 'complete'
            ? 'error'
            : 'incomplete',
        code: legacy
          ? 'legacy_document_translation_unverified'
          : version
            ? 'draft_document'
            : 'missing_document',
        locale,
        file: version?.file ?? entry.file,
        key: entry.id,
      });
    }
  }
  return diagnostics;
}

/** A document is resolved as one version, never through the UI fallback graph. */
export function resolveDocument<T extends ContentEntry>(
  entry: T,
  locale: string,
  registry: Pick<LocaleRegistry, 'sourceLocale'>,
) {
  const resolvedLocale = entry.versions?.[locale]
    ? locale
    : registry.sourceLocale;
  const version = entry.versions?.[resolvedLocale];
  return {
    ...entry,
    ...version,
    requestedLocale: locale,
    resolvedLocale: entry.kind === 'document' ? resolvedLocale : locale,
    fallback: entry.kind === 'document' && resolvedLocale !== locale,
    status: version?.status ?? 'complete',
    groupId:
      entry.group ??
      (typeof entry.title === 'string'
        ? entry.title
        : (entry.title[registry.sourceLocale] ?? '')
      ).split('/')[0],
  };
}

export function resolveDocumentLink(
  entries: readonly ContentEntry[],
  from: ContentEntry,
  locale: string,
  href: string,
  registry: Pick<LocaleRegistry, 'sourceLocale'>,
) {
  if (!href || /^[a-z]+:|^\/\//i.test(href)) return undefined;
  const selected = resolveDocument(from, locale, registry);
  const url = new URL(href, 'https://space.invalid/' + selected.file);
  const path = decodeURIComponent(url.pathname.slice(1));
  const prefix = from.documentPath
    ? selected.file.slice(0, -from.documentPath.length)
    : undefined;
  const logicalPath =
    prefix && path.startsWith(prefix) ? path.slice(prefix.length) : undefined;
  const entry = href.startsWith('#')
    ? from
    : entries.find(
        (item) =>
          item.file === path ||
          Object.values(item.versions ?? {}).some(
            (version) => version.file === path,
          ) ||
          (logicalPath !== undefined && item.documentPath === logicalPath),
      );
  return entry
    ? { entry, anchor: decodeURIComponent(url.hash.slice(1)) }
    : undefined;
}
