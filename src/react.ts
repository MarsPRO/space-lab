import {
  createContext,
  createElement,
  useContext,
  useCallback,
  useRef,
  useMemo,
} from 'react';
import type { ReactNode } from 'react';
import type { Theme, Preview, ExampleContext } from './index.js';
import type { Locale } from './i18n/locale.js';
import { I18nextProvider } from 'react-i18next';
import { prepareTranslator, engineSchema } from './i18n/translator.js';
import type {
  Translator,
  EngineSchema,
  MessageSchema,
  NamespaceMessages,
} from './i18n/translator.js';
import {
  legacyRegistry,
  localeChain,
  resolveLocale,
  I18nError,
  resolveText,
} from './i18n/registry.js';
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Default hook generics preserve dynamic consumer data access.
type DynamicValues = Record<string, any>;

const localeContext = createContext<Locale>('ru');
const i18nContext = createContext<Translator | null>(null);
const themeContext = createContext<Theme>('light');
const decoratorContext = createContext<NonNullable<Preview['decorators']>>([]);
const globalsContext = createContext<{
  values: DynamicValues;
  update: (values: Record<string, unknown>) => void;
}>({
  values: {},
  update: () => {
    /* The default provider has no subscribers. */
  },
});
const argsContext = createContext<{
  values: DynamicValues;
  update: (values: Record<string, unknown>) => void;
  reset: () => void;
  context: ExampleContext;
} | null>(null);
const previewContext = createContext<Preview>({});
const siteContext = createContext<{
  entries: import('./node/content.js').ContentEntry[];
  development: boolean;
}>({ entries: [], development: false });
// eslint-disable-next-line @typescript-eslint/naming-convention -- React provider exports use PascalCase for JSX.
export const SiteProvider = siteContext.Provider;
export const useSite = () => useContext(siteContext);
// eslint-disable-next-line @typescript-eslint/naming-convention -- React provider exports use PascalCase for JSX.
export const GlobalsProvider = globalsContext.Provider;
// eslint-disable-next-line @typescript-eslint/naming-convention -- React provider exports use PascalCase for JSX.
export const ArgsProvider = argsContext.Provider;
// eslint-disable-next-line @typescript-eslint/naming-convention -- React provider exports use PascalCase for JSX.
export const PreviewProvider = previewContext.Provider;
export const usePreview = () => useContext(previewContext);
export function useGlobals<Values extends DynamicValues = DynamicValues>() {
  const context = useContext(globalsContext),
    latest = useRef(context);
  latest.current = context;
  const update = useCallback((values: Partial<Values>) => {
    latest.current.update(values);
  }, []);
  return [context.values as Values, update] as const;
}
export function useArgs<Props extends DynamicValues = DynamicValues>() {
  const context = useContext(argsContext),
    latest = useRef(context);
  latest.current = context;
  const update = useCallback(
      (values: Partial<Props>) => latest.current?.update(values),
      [],
    ),
    reset = useCallback(() => latest.current?.reset(), []);
  if (!context) throw new Error('Space Lab: useArgs requires an example.');
  return [context.values as Props, update, reset] as const;
}
export function useExampleContext() {
  const context = useContext(argsContext);
  if (!context)
    throw new Error('Space Lab: useExampleContext requires an example.');
  return context.context;
}
export const useLoaded = <
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- Consumers explicitly select the loader-result type through this public hook.
  Data extends DynamicValues = DynamicValues,
>(): Data => useExampleContext().loaded as Data;
// eslint-disable-next-line @typescript-eslint/naming-convention -- React provider exports use PascalCase for JSX.
export const ThemeProvider = themeContext.Provider;
// eslint-disable-next-line @typescript-eslint/naming-convention -- React provider exports use PascalCase for JSX.
export const DecoratorsProvider = decoratorContext.Provider;
export const useTheme = () => useContext(themeContext);
export const useDecorators = () => useContext(decoratorContext);
export { Canvas } from './client/examples.js';
export {
  Title,
  Description,
  PropsTable,
  ArgsTable,
  Examples,
  Source,
  Note,
  Columns,
} from './client/blocks.js';

// eslint-disable-next-line @typescript-eslint/naming-convention -- Public React components use PascalCase for JSX.
export function LocaleProvider({
  locale,
  children,
}: {
  locale: Locale;
  children?: ReactNode;
}) {
  const i18n = useMemo(
    () => prepareTranslator({ locale: resolveLocale(locale) }),
    [locale],
  );
  return createElement(I18nProvider, { i18n }, children);
}

export function useLocale(): Locale {
  return useContext(localeContext);
}

// eslint-disable-next-line @typescript-eslint/naming-convention -- Public React components use PascalCase for JSX.
export function Localized(
  props:
    | { ru: ReactNode; en: ReactNode; values?: never }
    | { values: Partial<Record<string, ReactNode>>; ru?: never; en?: never },
): ReactNode {
  const locale = useLocale();
  const i18n = useContext(i18nContext);
  const registry = i18n?.registry ?? legacyRegistry;
  if ('values' in props && ('ru' in props || 'en' in props))
    throw new I18nError('mixed_localized_props');
  const values = props.values ?? { ru: props.ru, en: props.en };
  for (const tag of localeChain(locale, registry)) {
    if (
      !Object.hasOwn(values, tag) ||
      values[tag] === undefined ||
      values[tag] === null
    )
      continue;
    return tag === locale
      ? values[tag]
      : createElement(
          'span',
          {
            lang: tag,
            dir: registry.locales[tag].dir,
            'data-locale-fallback': true,
          },
          values[tag],
        );
  }
  return null;
}

// eslint-disable-next-line @typescript-eslint/naming-convention -- Public React components use PascalCase for JSX.
export function I18nProvider({
  i18n,
  children,
}: {
  i18n: Translator;
  children?: ReactNode;
}) {
  return createElement(
    i18nContext.Provider,
    { value: i18n },
    createElement(
      localeContext.Provider,
      { value: i18n.locale },
      createElement(I18nextProvider, { i18n: i18n.instance }, children),
    ),
  );
}
export function useI18n(): Translator {
  const provided = useContext(i18nContext);
  return useMemo(() => provided ?? prepareTranslator(), [provided]);
}
export function useMessages<N extends keyof EngineSchema>(
  namespace: N,
): NamespaceMessages<EngineSchema[N]>;
export function useMessages<
  S extends MessageSchema,
  N extends keyof S & string = keyof S & string,
>(namespace: N): NamespaceMessages<S[N]>;
export function useMessages(
  namespace: string,
): NamespaceMessages<
  Record<string, import('./i18n/translator.js').MessageDefinition>
> {
  const i18n = useI18n();
  return {
    t: (key, ...args) => i18n.t(namespace, key, ...args),
    message: (key, ...args) => i18n.message(namespace, key, ...args),
  };
}
export function useLabels() {
  const i18n = useI18n();
  return useMemo(
    () =>
      Object.fromEntries(
        (
          Object.keys(
            engineSchema.spaceLab,
          ) as (keyof EngineSchema['spaceLab'])[]
        )
          .filter(
            (
              key,
            ): key is Exclude<
              keyof EngineSchema['spaceLab'],
              'documentFallback' | 'searchResults'
            > => key !== 'documentFallback' && key !== 'searchResults',
          )
          .map((key) => [key, i18n.t('spaceLab', key)]),
      ) as Record<
        Exclude<
          keyof EngineSchema['spaceLab'],
          'documentFallback' | 'searchResults'
        >,
        string
      >,
    [i18n],
  );
}
export function useText() {
  const i18n = useI18n();
  return (value: import('./index.js').Text | undefined, locale = i18n.locale) =>
    resolveText(
      value,
      Object.hasOwn(i18n.registry.locales, locale) ? locale : i18n.locale,
      i18n.registry,
    ).value;
}
