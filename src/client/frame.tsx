import { resolveRoute } from '../runtime/routes.js';
import { resolveDocument, resolveDocumentLink } from '../runtime/documents.js';
import { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import type { ComponentType, AnchorHTMLAttributes } from 'react';
import { mountLocalized, prepareDocumentLocale } from './i18n.js';
import type { Translator } from '../i18n/translator.js';
import { config, entries, development } from 'virtual:space-lab/site';
import { MarkdownPre } from './code.js';
import { useThemePreference } from './theme.js';
import { resolveTheme } from '../runtime/theme.js';
import { loaders, preview } from 'virtual:space-lab/content';
import {
  useI18n,
  I18nProvider,
  useLocale,
  useLabels,
  ThemeProvider,
  DecoratorsProvider,
  GlobalsProvider,
  PreviewProvider,
  SiteProvider,
} from '../react.js';

import { ExamplesPage, StandaloneExample, ErrorBoundary } from './examples.js';
import { readState } from './shared.js';
import type { RuntimeDocumentation } from './definition.js';
import { MeasureOverlay } from './measure.js';
import { objectValue } from '../runtime/url.js';
import { updatePreviewState } from './shared.js';
import { configureActions, clearActions } from '../runtime/actions.js';
import './style.css';

function Frame() {
  const [state, setState] = useState(readState);
  const [loaded, setLoaded] = useState<{
    page: string;
    locale: string;
    i18n: Translator;
    module: { default: unknown };
  } | null>(null);
  const [error, setError] = useState('');
  const requested =
    state.get('page') ??
    config.home ??
    entries.find((entry) => entry.kind === 'document')?.id ??
    entries[0].id;
  const entry = resolveRoute(entries, requested);
  const page = entry?.id ?? requested;
  const locale = useLocale();
  const i18n = useI18n();
  const documentVersion = entry
    ? resolveDocument(entry, locale, i18n.registry)
    : undefined;
  const { preference, systemTheme } = useThemePreference(
    config.defaultTheme ?? 'system',
  );
  const theme = resolveTheme(state.get('theme'), preference, systemTheme);
  const labels = useLabels();
  const example = state.get('example') ?? '';
  const standalone = entry?.kind === 'examples' && !!example;
  const playground = entry?.kind === 'examples';
  const surface = playground ? (state.get('surface') ?? '') : '';
  const zoom = playground
    ? Math.max(0.5, Math.min(2, Number(state.get('zoom')) || 1))
    : 1;
  const globals = useMemo(
    () => ({
      ...Object.fromEntries(
        Object.entries(config.globalTypes ?? {}).map(([key, value]) => [
          key,
          value.defaultValue,
        ]),
      ),
      ...config.globals,
      ...objectValue(state.get('globals')),
    }),
    [state.get('globals')],
  );
  useLayoutEffect(() => {
    configureActions(config.actions ?? {});
    if (config.actions?.clearOnChange !== false) clearActions();
  }, [page, example]);
  useEffect(() => {
    if (parent !== window)
      parent.postMessage(
        {
          type: 'space-lab/extensions',
          panels: (preview.panels ?? []).map(({ id, title }) => ({
            id,
            title,
          })),
          tools: preview.tools ?? [],
        },
        location.origin,
      );
  }, []);
  useEffect(() => {
    const change = () => {
      setState(readState());
    };
    window.addEventListener('hashchange', change);
    return () => {
      window.removeEventListener('hashchange', change);
    };
  }, []);
  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = i18n.registry.locales[locale].dir;
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.surface = surface;
    document.documentElement.dataset.gridTone =
      surface === 'dark' || (surface !== 'light' && theme === 'dark')
        ? 'dark'
        : 'light';
    const step = config.grid?.step ?? 20;
    const styles = document.documentElement.style;
    styles.setProperty('--lab-grid-step', `${String(step * zoom)}px`);
    styles.setProperty(
      '--lab-grid-major',
      `${String(step * (config.grid?.majorEvery ?? 5) * zoom)}px`,
    );
    styles.setProperty(
      '--lab-grid-opacity',
      String(config.grid?.opacity ?? 0.55),
    );
    styles.setProperty(
      '--lab-grid-x',
      `${String(config.grid?.offsetX ?? 16)}px`,
    );
    styles.setProperty(
      '--lab-grid-y',
      `${String(config.grid?.offsetY ?? 16)}px`,
    );
  }, [locale, theme, surface, zoom]);
  useEffect(() => {
    let active = true;
    setError('');
    setLoaded(null);
    const load = loaders[page];
    if (!entry || !load) {
      setError(labels.notFound);
      return;
    }
    Promise.all([
      load(documentVersion?.resolvedLocale),
      entry.localized && documentVersion
        ? prepareDocumentLocale(documentVersion.resolvedLocale)
        : Promise.resolve(i18n),
    ])
      .then(([module, documentI18n]) => {
        if (active) setLoaded({ page, locale, module, i18n: documentI18n });
      })
      .catch((error: unknown) => {
        if (active) setError(String(error));
      });
    window.scrollTo(0, 0);
    return () => {
      active = false;
    };
  }, [page, locale]);
  useEffect(() => {
    if (loaded?.page !== page || loaded.locale !== locale) return;
    const anchor = state.get('anchor');
    if (anchor)
      requestAnimationFrame(() =>
        document.getElementById(anchor)?.scrollIntoView(),
      );
  }, [loaded, page, locale, state.get('anchor')]);
  function Link(props: AnchorHTMLAttributes<HTMLAnchorElement>) {
    const href = props.href;
    if (!href || /^[a-z]+:|^\/\//i.test(href)) return <a {...props} />;
    const link = entry
      ? resolveDocumentLink(entries, entry, locale, href, i18n.registry)
      : undefined;
    const destination = link?.entry;
    const parameters = new URLSearchParams(state);
    for (const [key, value] of Object.entries({
      page: destination?.id ?? '',
      locale,
      theme,
      anchor: link?.anchor ?? '',
      example: '',
    })) {
      if (value) parameters.set(key, value);
      else parameters.delete(key);
    }
    return destination ? (
      <a
        {...props}
        href={'index.html#' + parameters.toString()}
        target="_top"
      />
    ) : (
      <a {...props} />
    );
  }
  let content;
  if (error)
    content = (
      <div role="alert" className="lab-error">
        <h1>{entry ? labels.error : labels.notFound}</h1>
        <pre>{error}</pre>
        <div className="lab-recovery-actions">
          {entry && (
            <button
              onClick={() => {
                location.reload();
              }}
            >
              {labels.refresh}
            </button>
          )}
          <a
            href={
              'index.html#' +
              new URLSearchParams({
                page:
                  config.home ??
                  entries.find((item) => item.kind === 'document')?.id ??
                  entries[0].id,
                locale,
                theme,
              }).toString()
            }
            target="_top"
          >
            {labels.documentation}
          </a>
        </div>
      </div>
    );
  else if (loaded?.page !== page || loaded.locale !== locale)
    content = (
      <p role="status" className="lab-loading">
        {labels.loading}
      </p>
    );
  else if (standalone)
    content = (
      <StandaloneExample
        definition={loaded.module.default as RuntimeDocumentation}
        example={example}
        stage={{
          panel: state.get('panel') ?? '',
          grid: state.get('grid') === '1',
          outline: state.get('outline') === '1',
          surface: state.get('surface') ?? '',
          zoom,
        }}
      />
    );
  else if (entry?.kind === 'examples')
    content = (
      <ExamplesPage
        definition={loaded.module.default as RuntimeDocumentation}
      />
    );
  else {
    // eslint-disable-next-line @typescript-eslint/naming-convention -- JSX requires a PascalCase document component.
    const Document = loaded.module.default as ComponentType<{
      components: {
        a: ComponentType<AnchorHTMLAttributes<HTMLAnchorElement>>;
        pre: typeof MarkdownPre;
      };
    }>;
    content = (
      <I18nProvider i18n={loaded.i18n}>
        <Document components={{ a: Link, pre: MarkdownPre }} />
      </I18nProvider>
    );
  }
  return (
    <>
      <ThemeProvider value={theme}>
        <DecoratorsProvider value={preview.decorators ?? []}>
          <PreviewProvider value={preview}>
            <SiteProvider value={{ entries, development }}>
              <GlobalsProvider
                value={{
                  values: globals,
                  update: (values) => {
                    updatePreviewState(
                      { globals: JSON.stringify({ ...globals, ...values }) },
                      true,
                    );
                  },
                }}
              >
                <div
                  className="lab-preview-surface"
                  data-panel-dock={state.get('dock') ?? 'bottom'}
                  style={
                    {
                      '--lab-panel-size': `${String(Number(state.get('panelSize')) || (state.get('dock') === 'right' ? 420 : 310))}px`,
                    } as React.CSSProperties
                  }
                  data-grid={
                    playground && !standalone && state.get('grid') === '1'
                  }
                  data-outline={
                    playground && !standalone && state.get('outline') === '1'
                  }
                >
                  <article
                    lang={
                      entry?.localized
                        ? documentVersion?.resolvedLocale
                        : undefined
                    }
                    dir={
                      entry?.localized && documentVersion
                        ? i18n.registry.locales[documentVersion.resolvedLocale]
                            .dir
                        : undefined
                    }
                    className={standalone ? 'lab-preview' : 'lab-document'}
                    style={standalone ? undefined : { zoom }}
                    key={`page:${page}`}
                  >
                    <ErrorBoundary
                      label={labels.error}
                      resetKey={`${page}-${locale}-${theme}`}
                    >
                      {!error &&
                        loaded?.page === page &&
                        loaded.locale === locale &&
                        entry?.localized &&
                        documentVersion?.fallback && (
                          <p role="status" data-document-fallback="true">
                            {i18n.t('spaceLab', 'documentFallback', {
                              requestedName: i18n.registry.locales[locale].name,
                              resolvedName:
                                i18n.registry.locales[
                                  documentVersion.resolvedLocale
                                ].name,
                            })}
                          </p>
                        )}
                      {!error &&
                        loaded?.page === page &&
                        loaded.locale === locale &&
                        documentVersion?.status === 'draft' && (
                          <p data-document-draft="true">{labels.draft}</p>
                        )}
                      {content}
                    </ErrorBoundary>
                  </article>
                  {playground && state.get('measure') === '1' && (
                    <MeasureOverlay />
                  )}
                </div>
              </GlobalsProvider>
            </SiteProvider>
          </PreviewProvider>
        </DecoratorsProvider>
      </ThemeProvider>
    </>
  );
}
const root = document.getElementById('root');
if (!root) throw new Error('Space Lab: root element is missing.');
void mountLocalized(root, Frame).catch((error: unknown) => {
  root.textContent = String(error);
});
