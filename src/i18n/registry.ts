export type Locale = string;
export type LocalizedText = Partial<Record<Locale, string>>;
export type NavigationLabels = Record<string, LocalizedText>;
export function isLocalizedText(value: unknown): value is LocalizedText {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const entries = Object.entries(value);
  return (
    entries.length > 0 &&
    entries.every(([tag, text]) => {
      try {
        return canonicalLocale(tag) === tag && typeof text === 'string';
      } catch {
        return false;
      }
    })
  );
}
export interface LocaleDefinition {
  name: string;
  dir: 'ltr' | 'rtl';
  status: 'complete' | 'draft';
  fallback?: string[];
}
export interface LocaleRegistryInput {
  sourceLocale: string;
  fallbackLocale?: string;
  locales: Record<string, LocaleDefinition>;
}
export interface LocaleRegistry {
  sourceLocale: string;
  fallbackLocale: string;
  defaultLocale: string;
  locales: Record<string, LocaleDefinition & { fallback: string[] }>;
}
export class I18nError extends Error {
  constructor(
    public code: string,
    public params: Record<string, string> = {},
  ) {
    super(`Space Lab: ${code}: ${JSON.stringify(params)}`);
    this.name = 'I18nError';
  }
}
export function canonicalLocale(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^[a-z]{2,8}(?:-[a-z0-9]{2,8})*$/i.test(value) ||
    /(?:^|-)(?:u|t|x)(?:-|$)/i.test(value) ||
    value.toLowerCase() === 'cimode'
  )
    throw new I18nError('invalid_locale', { locale: String(value) });
  try {
    return Intl.getCanonicalLocales(value)[0];
  } catch {
    throw new I18nError('invalid_locale', { locale: value });
  }
}
export function createLocaleRegistry(
  input?: LocaleRegistryInput,
  defaultLocale?: string,
): LocaleRegistry {
  const source = input ?? {
    sourceLocale: 'ru',
    fallbackLocale: 'ru',
    locales: {
      ru: { name: 'Русский', dir: 'ltr', status: 'complete', fallback: [] },
      en: { name: 'English', dir: 'ltr', status: 'complete', fallback: ['ru'] },
    },
  };
  const sourceLocale = canonicalLocale(source.sourceLocale);
  const fallbackLocale = canonicalLocale(source.fallbackLocale ?? sourceLocale);
  const locales: LocaleRegistry['locales'] = {};
  for (const [raw, definition] of Object.entries(source.locales)) {
    const tag = canonicalLocale(raw);
    if (Object.hasOwn(locales, tag))
      throw new I18nError('duplicate_locale', { locale: tag });
    if (
      typeof definition.name !== 'string' ||
      !definition.name.trim() ||
      !['ltr', 'rtl'].includes(definition.dir) ||
      !['complete', 'draft'].includes(definition.status) ||
      (definition.fallback !== undefined && !Array.isArray(definition.fallback))
    )
      throw new I18nError('invalid_locale_definition', { locale: tag });
    locales[tag] = {
      ...definition,
      fallback: (
        definition.fallback ?? (tag === fallbackLocale ? [] : [fallbackLocale])
      ).map(canonicalLocale),
    };
  }
  const registry = {
    sourceLocale,
    fallbackLocale,
    defaultLocale: canonicalLocale(defaultLocale ?? sourceLocale),
    locales,
  };
  for (const tag of [sourceLocale, fallbackLocale, registry.defaultLocale])
    resolveSiteLocale(tag, registry);
  if (locales[sourceLocale].status !== 'complete')
    throw new I18nError('draft_source_locale');
  if (locales[fallbackLocale].fallback.length)
    throw new I18nError('terminal_locale_edges');
  for (const tag of Object.keys(locales)) {
    const visit = (current: string, parents: Set<string>): void => {
      resolveSiteLocale(current, registry);
      if (parents.has(current))
        throw new I18nError('locale_cycle', { locale: current });
      const edges = locales[current].fallback;
      if (!edges.length && current !== fallbackLocale)
        throw new I18nError('unterminated_locale', { locale: current });
      for (const next of edges) visit(next, new Set([...parents, current]));
    };
    visit(tag, new Set());
  }
  return registry;
}
export function resolveSiteLocale(
  value: unknown,
  registry: LocaleRegistry,
): Locale {
  const locale =
    value === undefined || value === null
      ? registry.defaultLocale
      : canonicalLocale(value);
  if (!Object.hasOwn(registry.locales, locale))
    throw new I18nError('unknown_locale', { locale });
  return locale;
}
export function localeChain(
  locale: string,
  registry: LocaleRegistry,
): string[] {
  const result: string[] = [];
  const visit = (tag: string) => {
    if (result.includes(tag)) return;
    result.push(tag);
    for (const next of registry.locales[tag].fallback) visit(next);
  };
  visit(resolveSiteLocale(locale, registry));
  return result;
}
export interface ResolvedText<T = string> {
  value: T;
  requestedLocale: Locale;
  resolvedLocale: Locale;
  fallback: boolean;
}
export function resolveText(
  value: string | LocalizedText | undefined,
  locale: Locale,
  registry = legacyRegistry,
): ResolvedText {
  const requestedLocale = resolveSiteLocale(locale, registry);
  if (typeof value === 'string')
    return {
      value,
      requestedLocale,
      resolvedLocale: requestedLocale,
      fallback: false,
    };
  for (const tag of localeChain(requestedLocale, registry)) {
    const text = value?.[tag];
    if (typeof text === 'string' && text.trim())
      return {
        value: text,
        requestedLocale,
        resolvedLocale: tag,
        fallback: tag !== requestedLocale,
      };
  }
  return {
    value: '',
    requestedLocale,
    resolvedLocale: registry.sourceLocale,
    fallback: true,
  };
}
export const legacyRegistry = createLocaleRegistry();
/** Legacy RU/EN compatibility helper. New code should use resolveSiteLocale. */
export function resolveLocale(
  value: unknown,
  fallback: 'ru' | 'en' = 'ru',
): 'ru' | 'en' {
  return value === 'ru' || value === 'en' ? value : fallback;
}
