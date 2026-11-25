import { createElement, useEffect, useRef, useState } from 'react';
import type { ComponentType } from 'react';
import { createRoot } from 'react-dom/client';
import { registry, schema, catalogLoaders } from 'virtual:space-lab/i18n';
import { prepareTranslator } from '../i18n/translator.js';
import type { CatalogResources, Translator } from '../i18n/translator.js';
import { localeChain, resolveSiteLocale } from '../i18n/registry.js';
import { I18nProvider } from '../react.js';
import { readState, updateState } from './shared.js';
import { isRecord } from '../runtime/data.js';

const catalogs = new Map<string, Promise<CatalogResources>>();
export { prepare as prepareDocumentLocale };
async function prepare(locale: string) {
  const chain = localeChain(locale, registry);
  // Reuse the shell's validated snapshot before committing a new iframe locale.
  // A second network load in the iframe could otherwise split the two UIs.
  const frame = window.frameElement;
  const encoded = frame?.getAttribute('data-i18n-resources');
  if (frame?.getAttribute('data-i18n-locale') === locale && encoded) {
    const snapshot: unknown = JSON.parse(encoded);
    if (
      !isRecord(snapshot) ||
      !Object.values(snapshot).every(
        (translations) =>
          isRecord(translations) &&
          Object.values(translations).every(
            (catalog) =>
              isRecord(catalog) &&
              Object.values(catalog).every(
                (value) => typeof value === 'string',
              ),
          ),
      )
    )
      throw new Error('Space Lab: invalid iframe catalog snapshot.');
    return prepareTranslator(
      { registry, schema, resources: snapshot as CatalogResources, locale },
      chain,
    );
  }
  const resources: CatalogResources = {};
  for (const tag of chain) {
    let pending = catalogs.get(tag);
    if (!pending) {
      pending = catalogLoaders[tag]().then((module) => module.default);
      catalogs.set(tag, pending);
      pending.catch(() => {
        catalogs.delete(tag);
      });
    }
    for (const [namespace, translations] of Object.entries(await pending)) {
      resources[namespace] ??= {};
      Object.assign(resources[namespace], translations);
    }
  }
  return prepareTranslator({ registry, schema, resources, locale }, chain);
}
function requestedLocale() {
  const raw = readState().get('locale');
  try {
    return { locale: resolveSiteLocale(raw, registry), unknown: false, raw };
  } catch {
    return { locale: registry.defaultLocale, unknown: true, raw };
  }
}
function canonicalize(locale: string) {
  const state = readState();
  state.set('locale', locale);
  history.replaceState(null, '', '#' + state.toString());
}
// eslint-disable-next-line @typescript-eslint/naming-convention -- Internal React bootstrap uses PascalCase for JSX.
function LocalizedSite({
  initial,
  component,
  unknown,
}: {
  initial: Translator;
  component: ComponentType;
  unknown: boolean;
}) {
  const [i18n, setI18n] = useState(initial);
  const [notice, setNotice] = useState<
    'unknownLocale' | 'localeLoadFailed' | ''
  >(unknown ? 'unknownLocale' : '');
  const latest = useRef(i18n);
  latest.current = i18n;
  useEffect(() => {
    let generation = 0;
    const change = () => {
      const current = ++generation;
      const requested = requestedLocale();
      if (requested.raw !== null && requested.raw !== requested.locale)
        canonicalize(requested.locale);
      if (requested.unknown) setNotice('unknownLocale');
      if (requested.locale === latest.current.locale) return;
      void prepare(requested.locale)
        .then((next) => {
          if (current === generation) {
            setI18n(next);
            if (!requested.unknown) setNotice('');
          }
        })
        .catch(() => {
          if (current !== generation) return;
          setNotice('localeLoadFailed');
          updateState({ locale: latest.current.locale }, true);
        });
    };
    window.addEventListener('hashchange', change);
    return () => {
      generation++;
      window.removeEventListener('hashchange', change);
    };
  }, []);
  return createElement(
    I18nProvider,
    { i18n },
    notice
      ? createElement(
          'div',
          { role: 'status', 'data-i18n-notice': notice },
          i18n.t('spaceLab', notice),
        )
      : null,
    createElement(component),
  );
}
export async function mountLocalized(
  root: HTMLElement,
  component: ComponentType,
) {
  const requested = requestedLocale();
  const initial = await prepare(requested.locale);
  if (requested.raw !== null && requested.raw !== requested.locale)
    canonicalize(requested.locale);
  createRoot(root).render(
    createElement(LocalizedSite, {
      initial,
      component,
      unknown: requested.unknown,
    }),
  );
}
