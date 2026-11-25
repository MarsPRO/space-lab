import { createInstance } from 'i18next';
import type { i18n } from 'i18next';
import en from './locales/en.json' with { type: 'json' };
import ru from './locales/ru.json' with { type: 'json' };
import type { MessageCatalog } from './locales/en.js';
import {
  I18nError,
  canonicalLocale,
  createLocaleRegistry,
  localeChain,
  resolveSiteLocale,
} from './registry.js';
import type { LocaleRegistry, ResolvedText } from './registry.js';

export interface MessageDefinition {
  params?: Record<string, 'string' | 'number' | 'boolean'>;
  plural?: 'cardinal';
}
export type MessageSchema = Record<string, Record<string, MessageDefinition>>;
export type CatalogResources = Record<
  string,
  Partial<Record<string, Record<string, string>>>
>;
interface StaticMessage {
  params?: never;
  plural?: never;
}
export type EngineSchema = Record<
  'spaceLab',
  {
    [
      K in
        | Exclude<
            keyof MessageCatalog,
            'searchResults_one' | 'searchResults_other'
          >
        | 'searchResults'
    ]: K extends 'documentFallback'
      ? { params: { requestedName: 'string'; resolvedName: 'string' } }
      : K extends 'searchResults'
        ? { params: { count: 'number' }; plural: 'cardinal' }
        : StaticMessage;
  }
>;
export const engineSchema = {
  spaceLab: {
    ...Object.fromEntries(
      Object.keys(en)
        .filter((key) => !key.startsWith('searchResults_'))
        .map((key) => [
          key,
          key === 'documentFallback'
            ? { params: { requestedName: 'string', resolvedName: 'string' } }
            : {},
        ]),
    ),
    searchResults: { params: { count: 'number' }, plural: 'cardinal' },
  },
} as EngineSchema;
export const builtInResources: CatalogResources = { spaceLab: { en, ru } };
type Primitive<P> = P extends 'number'
  ? number
  : P extends 'boolean'
    ? boolean
    : string;
type Params<D extends MessageDefinition> = D extends { params: infer P }
  ? { [K in keyof P]: Primitive<P[K]> }
  : Record<string, never>;
export type MessageArguments<D extends MessageDefinition> = D extends {
  params: Record<string, 'string' | 'number' | 'boolean'>;
}
  ? keyof Params<D> extends never
    ? [params?: Record<string, never>]
    : [params: Params<D>]
  : [params?: Record<string, never>];
export interface NamespaceMessages<
  D extends Record<string, MessageDefinition>,
> {
  t: <K extends keyof D & string>(
    key: K,
    ...args: MessageArguments<D[K]>
  ) => string;
  message: <K extends keyof D & string>(
    key: K,
    ...args: MessageArguments<D[K]>
  ) => ResolvedText;
}
export interface Translator<S extends MessageSchema = MessageSchema> {
  locale: string;
  registry: LocaleRegistry;
  schema: S & EngineSchema;
  resources: CatalogResources;
  instance: i18n;
  t<
    N extends keyof (S & EngineSchema) & string,
    K extends keyof (S & EngineSchema)[N] & string,
  >(
    namespace: N,
    key: K,
    ...args: MessageArguments<(S & EngineSchema)[N][K]>
  ): string;
  message<
    N extends keyof (S & EngineSchema) & string,
    K extends keyof (S & EngineSchema)[N] & string,
  >(
    namespace: N,
    key: K,
    ...args: MessageArguments<(S & EngineSchema)[N][K]>
  ): ResolvedText;
  number(value: number, options?: Intl.NumberFormatOptions): string;
  date(
    value: Date | number,
    options: Intl.DateTimeFormatOptions & { timeZone: string },
  ): string;
}
const forbidden = new Set([
  '__proto__',
  'prototype',
  'constructor',
  'lng',
  'lngs',
  'ns',
  'key',
  'defaultValue',
  'fallbackLng',
  'fallbackNS',
  'interpolation',
  'replace',
  'returnObjects',
  'returnDetails',
  'context',
  'ordinal',
  'postProcess',
  'joinArrays',
  'formatParams',
]);
const categories = ['zero', 'one', 'two', 'few', 'many', 'other'];
function safeName(name: string) {
  if (!name || ['__proto__', 'prototype', 'constructor'].includes(name))
    throw new I18nError('reserved_message_name', { name });
}
export function familyKeys(
  key: string,
  definition: MessageDefinition,
  locale: string,
): string[] {
  return definition.plural
    ? new Intl.PluralRules(locale)
        .resolvedOptions()
        .pluralCategories.map((category) => `${key}_${category}`)
    : [key];
}
export function validateSchema(schema: MessageSchema) {
  for (const [namespace, definitions] of Object.entries(schema)) {
    safeName(namespace);
    for (const [key, definition] of Object.entries(definitions)) {
      safeName(key);
      if (
        definition.plural !== undefined &&
        !['cardinal'].includes(definition.plural)
      )
        throw new I18nError('invalid_plural', { key });
      for (const [name, type] of Object.entries(definition.params ?? {})) {
        safeName(name);
        if (
          forbidden.has(name) ||
          !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) ||
          !['string', 'number', 'boolean'].includes(type)
        )
          throw new I18nError('invalid_message_param', { name });
      }
      if (definition.plural && definition.params?.count !== 'number')
        throw new I18nError('plural_requires_count', { key });
      if (
        categories.some((category) =>
          Object.hasOwn(definitions, `${key}_${category}`),
        )
      )
        throw new I18nError('plural_key_collision', { key });
    }
  }
}
export function validateCatalog(
  catalog: Record<string, string>,
  definitions: Record<string, MessageDefinition>,
  locale: string,
) {
  const allowed = new Map<string, MessageDefinition>();
  for (const [key, definition] of Object.entries(definitions)) {
    for (const member of familyKeys(key, definition, locale))
      allowed.set(member, definition);
  }
  for (const [key, value] of Object.entries(catalog)) {
    safeName(key);
    const definition = allowed.get(key);
    if (!definition)
      throw new I18nError('unknown_message_key', { locale, key });
    if (typeof value !== 'string')
      throw new I18nError('invalid_message_value', { locale, key });
    const placeholders = [
      ...value.matchAll(/{{([A-Za-z_][A-Za-z0-9_]*)}}/g),
    ].map((match) => match[1]);
    const remainder = value.replace(/{{([A-Za-z_][A-Za-z0-9_]*)}}/g, '');
    if (/[{}]|\$t\(/.test(remainder))
      throw new I18nError('invalid_message_syntax', { locale, key });
    if (
      value.trim() &&
      (placeholders.some(
        (name) => !Object.hasOwn(definition.params ?? {}, name),
      ) ||
        Object.keys(definition.params ?? {}).some(
          (name) => !placeholders.includes(name),
        ))
    )
      throw new I18nError('message_placeholder_mismatch', { locale, key });
  }
}
/** Overlay blanks do not remove a valid same-locale built-in message. */
export function effectiveCatalog(
  namespace: string,
  locale: string,
  overlay?: Record<string, string>,
) {
  return {
    ...(Object.hasOwn(builtInResources, namespace)
      ? builtInResources[namespace][locale]
      : undefined),
    ...Object.fromEntries(
      Object.entries(overlay ?? {}).filter(([, value]) => value.trim()),
    ),
  };
}
export function prepareTranslator<const S extends MessageSchema = EngineSchema>(
  options: {
    registry?: LocaleRegistry;
    resources?: CatalogResources;
    locale?: string;
    schema?: S;
  } = {},
  validationLocales?: string[],
): Translator<S> {
  const registry = createLocaleRegistry(
    options.registry,
    options.registry?.defaultLocale,
  );
  const locale = resolveSiteLocale(options.locale, registry);
  if (options.schema && Object.hasOwn(options.schema, 'spaceLab'))
    throw new I18nError('reserved_namespace');
  const definitionsByNamespace: MessageSchema = {
    ...options.schema,
    ...engineSchema,
  };
  validateSchema(definitionsByNamespace);
  const schema = structuredClone(definitionsByNamespace) as S & EngineSchema;
  const resources: CatalogResources = {};
  for (const [namespace, translations] of Object.entries(
    options.resources ?? {},
  )) {
    safeName(namespace);
    if (!Object.hasOwn(schema, namespace))
      throw new I18nError('unknown_namespace', { namespace });
    resources[namespace] = {};
    for (const [raw, catalog] of Object.entries(translations)) {
      const tag = resolveSiteLocale(raw, registry);
      if (Object.hasOwn(resources[namespace], tag))
        throw new I18nError('duplicate_catalog_locale', { locale: tag });
      if (!catalog)
        throw new I18nError('invalid_catalog', { namespace, locale: tag });
      validateCatalog(catalog, schema[namespace], tag);
      resources[namespace][tag] = { ...catalog };
    }
  }
  const effective: CatalogResources = {};
  for (const [namespace, definitions] of Object.entries(
    definitionsByNamespace,
  )) {
    effective[namespace] = {};
    for (const [tag, info] of Object.entries(registry.locales)) {
      const overlay = Object.hasOwn(resources, namespace)
        ? resources[namespace][tag]
        : undefined;
      const catalog = effectiveCatalog(namespace, tag, overlay);
      const missing = new Set<string>();
      for (const [key, definition] of Object.entries(definitions)) {
        const keys = familyKeys(key, definition, tag);
        if (
          keys.some(
            (member) =>
              !Object.hasOwn(catalog, member) || !catalog[member].trim(),
          )
        ) {
          if (
            (!validationLocales || validationLocales.includes(tag)) &&
            (info.status === 'complete' ||
              (namespace !== 'spaceLab' && tag === registry.fallbackLocale))
          )
            throw new I18nError('incomplete_catalog', {
              namespace,
              locale: tag,
              key,
            });
          for (const member of definition.plural
            ? categories.map((category) => `${key}_${category}`)
            : [key])
            missing.add(member);
        }
      }
      effective[namespace][tag] = Object.fromEntries(
        Object.entries(catalog).filter(([key]) => !missing.has(key)),
      );
    }
  }
  const instance = createInstance();
  const engineResources = new Map<
    string,
    Record<string, Record<string, string>>
  >();
  for (const [namespace, translations] of Object.entries(effective))
    for (const [tag, catalog] of Object.entries(translations)) {
      const namespaces = engineResources.get(tag) ?? {};
      namespaces[namespace] = catalog ?? {};
      engineResources.set(tag, namespaces);
    }
  if (!Object.hasOwn(registry.locales, 'en'))
    engineResources.set('en', { spaceLab: en });
  void instance.init({
    lng: locale,
    resources: Object.fromEntries(engineResources),
    fallbackLng: false,
    fallbackNS: false,
    load: 'currentOnly',
    keySeparator: false,
    nsSeparator: false,
    defaultNS: 'spaceLab',
    ns: Object.keys(schema),
    initAsync: false,
    interpolation: { escapeValue: false },
    returnNull: false,
    returnObjects: false,
  });
  if (!instance.isInitialized) throw new I18nError('translator_not_ready');
  const message = (
    namespace: string,
    key: string,
    params: Record<string, unknown> = {},
  ): ResolvedText => {
    if (
      !Object.hasOwn(schema, namespace) ||
      !Object.hasOwn(schema[namespace], key)
    )
      throw new I18nError('unknown_message_key', { namespace, key });
    const definition = schema[namespace][key];
    const expected = definition.params ?? {};
    for (const name of Object.keys(params))
      if (!Object.hasOwn(expected, name))
        throw new I18nError('unknown_message_param', { name });
    for (const [name, type] of Object.entries(expected))
      if (
        !Object.hasOwn(params, name) ||
        typeof params[name] !== type ||
        (type === 'number' && !Number.isFinite(params[name]))
      )
        throw new I18nError('invalid_message_param', { name });
    for (const tag of [
      ...localeChain(locale, registry),
      ...(namespace === 'spaceLab' ? ['en'] : []),
    ]) {
      const catalog =
        effective[namespace][tag] ??
        (namespace === 'spaceLab' && tag === 'en' ? en : {});
      if (
        !familyKeys(key, definition, tag).every((member) =>
          Object.hasOwn(catalog, member),
        )
      )
        continue;
      const value = instance.t(key, {
        ns: namespace,
        lng: tag,
        replace: params,
        ...(definition.plural ? { count: Number(params.count) } : {}),
      });
      return {
        value,
        requestedLocale: locale,
        resolvedLocale: tag,
        fallback: tag !== locale,
      };
    }
    throw new I18nError('missing_message', { namespace, key });
  };
  return {
    locale,
    registry,
    schema,
    resources,
    instance,
    message,
    t: (namespace: string, key: string, params?: Record<string, unknown>) =>
      message(namespace, key, params).value,
    number: (value, options) =>
      new Intl.NumberFormat(canonicalLocale(locale), options).format(value),
    date: (value, options) => {
      if (!options.timeZone) throw new I18nError('date_requires_timezone');
      return new Intl.DateTimeFormat(locale, options).format(value);
    },
  };
}
export async function createTranslator<
  const S extends MessageSchema = EngineSchema,
>(
  options: Parameters<typeof prepareTranslator<S>>[0] = {},
): Promise<Translator<S>> {
  return await Promise.resolve(prepareTranslator(options));
}
