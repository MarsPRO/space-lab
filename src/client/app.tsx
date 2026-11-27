import { resolveRoute } from '../runtime/routes.js';
import { resolveDocument } from '../runtime/documents.js';
import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent } from 'react';
import { mountLocalized } from './i18n.js';
import { config, entries, engineVersion } from 'virtual:space-lab/site';
import { translateLabel } from '../i18n/locale.js';
import { readState, updateState } from './shared.js';
import { Icon } from './icons.js';
import type { IconName } from './icons.js';
import {
  ViewportControl,
  ViewportFrame,
  viewportDimensions,
} from './viewport.js';
import { objectValue } from '../runtime/url.js';
import { asRecord, isRecord } from '../runtime/data.js';
import { isLocalizedText } from '../i18n/registry.js';
import { useI18n, useLocale, useLabels, useText } from '../react.js';
import { ControlInput, controlText } from './controls.js';
import type { Text, ExtensionTool } from '../index.js';
import { usePopover } from './popover.js';
import { useThemePreference } from './theme.js';
import { resolveTheme, themePreference } from '../runtime/theme.js';
import './style.css';

function isText(value: unknown): value is Text {
  return typeof value === 'string' || isLocalizedText(value);
}
function isPanel(value: unknown): value is { id: string; title: Text } {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    /^[a-z][a-z0-9-]{0,60}$/.test(value.id) &&
    Boolean(value.title) &&
    isText(value.title)
  );
}
function isTool(value: unknown): value is ExtensionTool {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.global === 'string' &&
    Boolean(value.title) &&
    isText(value.title) &&
    (value.options === undefined ||
      (Array.isArray(value.options) &&
        value.options.every(
          (option: unknown) =>
            typeof option === 'string' || typeof option === 'number',
        )))
  );
}

function Tool({
  icon,
  label,
  onClick,
  active,
  disabled = false,
  expanded,
}: {
  icon: IconName;
  label: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  expanded?: boolean;
}) {
  return (
    <button
      className="lab-icon-button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      aria-expanded={expanded}
      aria-haspopup={expanded === undefined ? undefined : 'menu'}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon name={icon} />
    </button>
  );
}

function App() {
  const [state, setState] = useState(readState);
  const [query, setQuery] = useState('');
  const [menu, setMenu] = useState(false);
  const [mobile, setMobile] = useState(
    () => matchMedia('(max-width: 760px)').matches,
  );
  const [settings, setSettings] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [generation, setGeneration] = useState(0);
  const [backgroundMenu, setBackgroundMenu] = useState(false);
  const [fullscreen, setFullscreen] = useState(!!document.fullscreenElement);
  const [fullscreenError, setFullscreenError] = useState(false);
  const [panelsMenu, setPanelsMenu] = useState(false);
  const [extensionPanels, setExtensionPanels] = useState<
    { id: string; title: Text }[]
  >([]);
  const [extensionTools, setExtensionTools] = useState<ExtensionTool[]>([]);
  const search = useRef<HTMLInputElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const settingsButton = useRef<HTMLButtonElement>(null);
  const sidebar = useRef<HTMLElement>(null);
  const workspace = useRef<HTMLDivElement>(null);
  const iframe = useRef<HTMLIFrameElement>(null);
  const backgroundAnchor = useRef<HTMLDivElement>(null),
    panelsAnchor = useRef<HTMLDivElement>(null);
  const backgroundPosition = usePopover(backgroundAnchor, 205, backgroundMenu),
    panelsPosition = usePopover(panelsAnchor, 215, panelsMenu);
  const locale = useLocale();
  const i18n = useI18n();
  const localizedEntries = entries.map((entry) =>
    resolveDocument(entry, locale, i18n.registry),
  );
  const text = useText();
  const { preference, setPreference, systemTheme } = useThemePreference(
    config.defaultTheme ?? 'system',
  );
  const theme = resolveTheme(state.get('theme'), preference, systemTheme);
  const labels = useLabels();
  const home =
    resolveRoute(entries, config.home)?.id ??
    entries.find((entry) => entry.kind === 'document')?.id ??
    entries[0].id;
  const requested = state.get('page') ?? home;
  const current = resolveRoute(localizedEntries, requested);
  const page = current?.id ?? requested;
  const example = state.get('example') ?? '';
  const canvas = current?.kind === 'examples' && !!example;
  const playground = current?.kind === 'examples';
  const documents = entries.filter((entry) => entry.kind === 'document');
  const components = entries.filter((entry) => entry.kind === 'examples');
  const lastDocument = useRef(
      documents.find((entry) => entry.id === home)?.id ??
        documents.at(0)?.id ??
        home,
    ),
    lastExample = useRef(components[0]?.id ?? home);
  const lastExampleName = useRef(components[0]?.examples?.[0] ?? '');
  useEffect(() => {
    if (playground) {
      lastExample.current = page;
      lastExampleName.current = example;
    } else if (current) lastDocument.current = page;
  }, [page, example, playground]);
  useEffect(() => {
    setQuery('');
    setBackgroundMenu(false);
    setPanelsMenu(false);
  }, [playground]);
  const panel = state.get('panel') ?? '';
  const zoom = Math.max(0.5, Math.min(2, Number(state.get('zoom')) || 1));
  const sidebarWidth = Math.max(
    220,
    Math.min(560, Number(state.get('sidebar')) || 299),
  );
  const globals = {
    ...Object.fromEntries(
      Object.entries(config.globalTypes ?? {}).map(([key, value]) => [
        key,
        value.defaultValue,
      ]),
    ),
    ...config.globals,
    ...objectValue(state.get('globals')),
  };
  const pageTitle = canvas
    ? text(current.exampleNames?.[example], locale) || example
    : current
      ? (text(current.title, locale).split('/').pop() ?? '')
      : labels.notFound;
  const order = config.sectionOrder ?? [
    'Guide',
    'Руководство',
    'Components',
    'Компоненты',
    'API',
    'Changelog',
    'Изменения',
  ];
  const titleParts = (entry: (typeof entries)[number]) =>
    text(entry.title, locale).split('/');
  const translate = (name: string, id: string) =>
    translateLabel(name, id, locale, config.labels, i18n.registry, labels);
  const update = (values: Record<string, string>, replace = false) => {
    updateState({ page, locale, ...values }, replace);
  };
  const updateGlobals = (values: Record<string, unknown>) => {
    update({ globals: JSON.stringify({ ...globals, ...values }) }, true);
  };
  const openPanel = (id: string) => {
    update({ example: example || (current?.examples?.[0] ?? ''), panel: id });
    setPanelsMenu(false);
  };
  function resizeSidebar(event: PointerEvent<HTMLDivElement>) {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const start = event.clientX;
    const move = (current: globalThis.PointerEvent) => {
      update(
        {
          sidebar: String(
            Math.max(
              220,
              Math.min(560, Math.round(sidebarWidth + current.clientX - start)),
            ),
          ),
        },
        true,
      );
    };
    const end = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  }
  const toggle = (key: string) => {
    setCollapsed((previous) => ({ ...previous, [key]: !previous[key] }));
  };
  useEffect(() => {
    const change = () => {
      setState(readState());
      setMenu(false);
    };
    const receive = (event: MessageEvent<unknown>) => {
      const data = asRecord(event.data);
      if (
        event.origin === location.origin &&
        event.source === iframe.current?.contentWindow &&
        data.type === 'space-lab/state'
      ) {
        const values: Record<string, string> = {};
        for (const [key, value] of Object.entries(asRecord(data.values))) {
          if (typeof value !== 'string' || value.length > 1_000_000) continue;
          if (
            key === 'panel' &&
            (value === '' || /^[a-z][a-z0-9-]{0,60}$/.test(value))
          )
            values[key] = value;
          if (key === 'dock' && ['', 'bottom', 'right'].includes(value))
            values[key] = value;
          if (
            key === 'panelSize' &&
            (value === '' || (Number(value) >= 100 && Number(value) <= 900))
          )
            values[key] = value;
          if (key === 'args' || key === 'globals') values[key] = value;
        }
        if (Object.keys(values).length)
          updateState(values, data.replace === true);
      }
      if (
        event.origin === location.origin &&
        event.source === iframe.current?.contentWindow &&
        data.type === 'space-lab/extensions'
      ) {
        setExtensionPanels(
          (Array.isArray(data.panels) ? (data.panels as unknown[]) : []).filter(
            isPanel,
          ),
        );
        setExtensionTools(
          (Array.isArray(data.tools) ? (data.tools as unknown[]) : []).filter(
            isTool,
          ),
        );
      }
    };
    const fullscreenChanged = () => {
      setFullscreen(!!document.fullscreenElement);
    };
    window.addEventListener('hashchange', change);
    window.addEventListener('message', receive);
    document.addEventListener('fullscreenchange', fullscreenChanged);
    return () => {
      window.removeEventListener('hashchange', change);
      window.removeEventListener('message', receive);
      document.removeEventListener('fullscreenchange', fullscreenChanged);
    };
  }, []);
  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = i18n.registry.locales[locale].dir;
    document.documentElement.dataset.theme = theme;
    document.title = `${pageTitle} · ${config.name}`;
  }, [locale, theme, pageTitle]);
  useEffect(() => {
    const media = matchMedia('(max-width: 760px)');
    const change = () => {
      setMobile(media.matches);
      if (!media.matches) setMenu(false);
    };
    media.addEventListener('change', change);
    return () => {
      media.removeEventListener('change', change);
    };
  }, []);
  useEffect(() => {
    if (!menu || !mobile) return;
    const opener = document.activeElement;
    const content = workspace.current;
    if (content) content.inert = true;
    search.current?.focus();
    const trapFocus = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const items = [
        ...(sidebar.current?.querySelectorAll<HTMLElement>(
          'a[href],button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]',
        ) ?? []),
      ].filter((item) => item.getClientRects().length);
      const first = items[0];
      const last = items.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', trapFocus);
    return () => {
      document.removeEventListener('keydown', trapFocus);
      if (content) content.inert = false;
      if (opener instanceof HTMLElement && opener.getClientRects().length)
        opener.focus();
    };
  }, [menu, mobile]);
  useEffect(() => {
    const keys = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (settings) settingsButton.current?.focus();
        else if (backgroundMenu)
          backgroundAnchor.current?.querySelector('button')?.focus();
        else if (panelsMenu)
          panelsAnchor.current?.querySelector('button')?.focus();
        setMenu(false);
        setSettings(false);
        setBackgroundMenu(false);
        setPanelsMenu(false);
        setQuery('');
      }
      if (
        event.key === '/' &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        !(event.target instanceof HTMLInputElement) &&
        !(event.target instanceof HTMLTextAreaElement) &&
        !(event.target instanceof HTMLSelectElement) &&
        !(event.target instanceof HTMLElement && event.target.isContentEditable)
      ) {
        event.preventDefault();
        search.current?.focus();
        if (mobile) setMenu(true);
      }
    };
    window.addEventListener('keydown', keys);
    return () => {
      window.removeEventListener('keydown', keys);
    };
  }, [mobile, settings, backgroundMenu, panelsMenu]);
  const filtered = localizedEntries
    .filter((entry) => (entry.kind === 'examples') === playground)
    .filter((entry) => {
      const title = titleParts(entry)
        .map((part, index) => translate(part, index ? entry.id : part))
        .join(' ');
      return `${title} ${text(entry.description, locale)} ${entry.search}`
        .toLocaleLowerCase()
        .includes(query.toLocaleLowerCase());
    });
  const groups = new Map<string, typeof localizedEntries>();
  for (const entry of filtered) {
    const parts = titleParts(entry),
      group = parts.length > 1 ? entry.groupId : labels.documentation;
    groups.set(group, [...(groups.get(group) ?? []), entry]);
  }
  const groupOrder = (group: string) => {
    const index = order.indexOf(group);
    return index < 0 ? order.length : index;
  };
  const href = (id: string, selectedExample = '') => {
    const params = new URLSearchParams(state);
    for (const [key, value] of Object.entries({
      page: id,
      locale,
      example: selectedExample,
    })) {
      if (value) params.set(key, value);
      else params.delete(key);
    }
    if (selectedExample && !params.get('panel')) params.set('panel', 'props');
    return '#' + params.toString();
  };
  const parameters = new URLSearchParams(state);
  for (const [key, value] of Object.entries({ page, locale, theme }))
    parameters.set(key, value);
  const frame = 'preview.html#' + parameters.toString();
  const panels = [
    { id: 'props', title: labels.props },
    { id: 'code', title: labels.code },
    { id: 'actions', title: labels.actions },
    { id: 'interactions', title: labels.interactions },
    { id: 'api', title: labels.api },
    { id: 'a11y', title: labels.accessibility },
    { id: 'visual', title: labels.visual },
    ...extensionPanels,
  ];
  return (
    <>
      <div
        className={`lab-shell ${playground ? 'lab-playground-shell' : 'lab-docs-shell'}`}
        style={
          {
            '--lab-sidebar-width': `${String(sidebarWidth)}px`,
          } as CSSProperties
        }
      >
        <aside
          ref={sidebar}
          id="lab-navigation"
          className={`lab-sidebar ${menu ? 'is-open' : ''}`}
          aria-label={labels.documentation}
          role={mobile && menu ? 'dialog' : undefined}
          aria-modal={mobile && menu ? true : undefined}
          onClick={(event) => {
            if (
              mobile &&
              event.target instanceof Element &&
              event.target.closest('a[href]') &&
              !event.ctrlKey &&
              !event.metaKey &&
              !event.shiftKey &&
              !event.altKey
            )
              setMenu(false);
          }}
        >
          <div className="lab-sidebar-header">
            <a className="lab-brand" href={href(home)} title={config.name}>
              {config.name}
            </a>
            <button
              ref={settingsButton}
              className="lab-icon-button"
              title={labels.settings}
              aria-label={labels.settings}
              aria-expanded={settings}
              onClick={() => {
                setSettings(!settings);
              }}
            >
              <Icon name="settings" />
            </button>
            <button
              className="lab-icon-button lab-navigation-close"
              aria-label={labels.menu}
              onClick={() => {
                setMenu(false);
              }}
            >
              <Icon name="close" />
            </button>
            {settings && (
              <div className="lab-settings">
                <strong>{labels.settings}</strong>
                <label>
                  {labels.appearanceTheme}
                  <select
                    aria-label={labels.appearanceTheme}
                    defaultValue="default"
                  >
                    <option value="default">
                      {labels.defaultAppearanceTheme}
                    </option>
                  </select>
                </label>
                <label>
                  {labels.defaultTheme}
                  <select
                    aria-label={labels.defaultTheme}
                    value={preference}
                    onChange={(event) => {
                      setPreference(themePreference(event.target.value));
                      updateState({ theme: '' }, true);
                    }}
                  >
                    <option value="light">{labels.light}</option>
                    <option value="dark">{labels.dark}</option>
                    <option value="system">{labels.systemTheme}</option>
                  </select>
                </label>
                <small>Space Lab {engineVersion}</small>
              </div>
            )}
          </div>
          <nav className="lab-spaces" aria-label={labels.spaces}>
            {!!documents.length && (
              <a
                href={href(lastDocument.current)}
                aria-current={!playground ? 'page' : undefined}
              >
                {labels.documentation}
              </a>
            )}
            {!!components.length && (
              <a
                href={href(lastExample.current, lastExampleName.current)}
                aria-current={playground ? 'page' : undefined}
              >
                {labels.playground}
              </a>
            )}
          </nav>
          <div className="lab-search">
            <Icon name="search" />
            <input
              ref={search}
              type="search"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
              }}
              placeholder={playground ? labels.searchExamples : labels.search}
              aria-label={playground ? labels.searchExamples : labels.search}
            />
            <kbd>/</kbd>
          </div>
          {query && (
            <p className="lab-sr-only" role="status">
              {i18n.t('spaceLab', 'searchResults', { count: filtered.length })}
            </p>
          )}
          <nav
            onKeyDown={(event) => {
              if (
                ![
                  'ArrowUp',
                  'ArrowDown',
                  'ArrowLeft',
                  'ArrowRight',
                  'Home',
                  'End',
                ].includes(event.key)
              )
                return;
              const items = [
                  ...event.currentTarget.querySelectorAll<HTMLElement>(
                    'h2 button,.lab-tree-row',
                  ),
                ],
                index = items.indexOf(document.activeElement as HTMLElement);
              if (index < 0) return;
              event.preventDefault();
              const item = items[index];
              if (
                (event.key === 'ArrowLeft' &&
                  item.getAttribute('aria-expanded') === 'true') ||
                (event.key === 'ArrowRight' &&
                  item.getAttribute('aria-expanded') === 'false')
              )
                item.click();
              else
                items[
                  event.key === 'Home'
                    ? 0
                    : event.key === 'End'
                      ? items.length - 1
                      : (index +
                          (event.key === 'ArrowUp' || event.key === 'ArrowLeft'
                            ? items.length - 1
                            : 1)) %
                        items.length
                ]?.focus();
            }}
          >
            {[...groups]
              .sort(
                ([first], [second]) => groupOrder(first) - groupOrder(second),
              )
              .map(([group, items]) => (
                <section className="lab-nav-group" key={group}>
                  <h2>
                    <button
                      aria-expanded={!collapsed['group:' + group] || !!query}
                      onClick={() => {
                        toggle('group:' + group);
                      }}
                    >
                      <Icon name="chevron" />
                      {translate(
                        items[0].group || titleParts(items[0]).length <= 1
                          ? group
                          : titleParts(items[0])[0],
                        group,
                      )}
                    </button>
                  </h2>
                  {(!collapsed['group:' + group] || !!query) &&
                    items.map((entry) => {
                      const name = translate(
                        titleParts(entry).slice(1).join(' / ') ||
                          titleParts(entry)[0],
                        entry.id,
                      );
                      if (entry.kind === 'document')
                        return (
                          <a
                            className="lab-tree-row lab-document-link"
                            data-document-fallback={
                              entry.localized && entry.fallback
                                ? true
                                : undefined
                            }
                            title={
                              entry.localized && entry.fallback
                                ? i18n.t('spaceLab', 'documentFallback', {
                                    requestedName:
                                      i18n.registry.locales[locale].name,
                                    resolvedName:
                                      i18n.registry.locales[
                                        entry.resolvedLocale
                                      ].name,
                                  })
                                : undefined
                            }
                            key={entry.id}
                            href={href(entry.id)}
                            aria-current={
                              entry.id === page ? 'page' : undefined
                            }
                          >
                            <Icon name="document" />
                            {name}
                            {entry.localized && entry.fallback && (
                              <small>
                                {' '}
                                ·{' '}
                                {
                                  i18n.registry.locales[entry.resolvedLocale]
                                    .name
                                }
                              </small>
                            )}
                            {entry.status === 'draft' && (
                              <small> · {labels.draft}</small>
                            )}
                          </a>
                        );
                      const expanded = !collapsed[entry.id] || !!query;
                      return (
                        <div className="lab-tree-node" key={entry.id}>
                          <button
                            className="lab-tree-row lab-node-toggle"
                            aria-expanded={expanded}
                            onClick={() => {
                              toggle(entry.id);
                            }}
                          >
                            <Icon name="chevron" />
                            <Icon name="component" />
                            {name}
                          </button>
                          {expanded && (
                            <div className="lab-tree-children">
                              <a
                                className="lab-tree-row lab-document-link"
                                href={href(entry.id)}
                                aria-current={
                                  entry.id === page && !example
                                    ? 'page'
                                    : undefined
                                }
                              >
                                <Icon name="document" />
                                {labels.documentation}
                              </a>
                              {entry.examples?.map((key) => (
                                <a
                                  className="lab-tree-row lab-example-link"
                                  key={key}
                                  href={href(entry.id, key)}
                                  aria-current={
                                    entry.id === page && example === key
                                      ? 'page'
                                      : undefined
                                  }
                                >
                                  <Icon name="example" />
                                  {text(entry.exampleNames?.[key], locale) ||
                                    key}
                                </a>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                </section>
              ))}
            {!filtered.length && (
              <div className="lab-empty-search">
                <p className="lab-muted">{labels.empty}</p>
                {query && (
                  <button
                    onClick={() => {
                      setQuery('');
                      search.current?.focus();
                    }}
                  >
                    {labels.clear}
                  </button>
                )}
              </div>
            )}
          </nav>
          <div
            className="lab-sidebar-resizer"
            role="separator"
            tabIndex={0}
            aria-label={labels.resizeSidebar}
            aria-orientation="vertical"
            aria-valuemin={220}
            aria-valuemax={560}
            aria-valuenow={sidebarWidth}
            onPointerDown={resizeSidebar}
            onDoubleClick={() => {
              update({ sidebar: '' }, true);
            }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                event.preventDefault();
                update(
                  {
                    sidebar: String(
                      Math.max(
                        220,
                        Math.min(
                          560,
                          sidebarWidth +
                            (event.key === 'ArrowRight' ? 10 : -10),
                        ),
                      ),
                    ),
                  },
                  true,
                );
              }
            }}
          />
        </aside>
        {menu && mobile && (
          <button
            className="lab-backdrop"
            aria-label={labels.menu}
            tabIndex={-1}
            onClick={() => {
              setMenu(false);
            }}
          />
        )}
        <div ref={workspace} className="lab-workspace">
          <header className="lab-toolbar" aria-label={labels.documentation}>
            <button
              ref={menuButton}
              className="lab-icon-button lab-menu-button"
              aria-label={labels.menu}
              aria-expanded={menu}
              aria-controls="lab-navigation"
              onClick={() => {
                setMenu(!menu);
              }}
            >
              <Icon name="menu" />
            </button>
            {!playground && (
              <div className="lab-breadcrumb">
                <span>{labels.documentation}</span>
                <strong>{pageTitle}</strong>
              </div>
            )}
            {playground && (
              <>
                <div className="lab-tool-group">
                  <Tool
                    icon="refresh"
                    label={labels.refresh}
                    onClick={() => {
                      setGeneration(generation + 1);
                    }}
                  />
                  <Tool
                    icon="grid"
                    label={labels.grid}
                    active={state.get('grid') === '1'}
                    onClick={() => {
                      update({ grid: state.get('grid') === '1' ? '' : '1' });
                    }}
                  />
                  <div
                    ref={backgroundAnchor}
                    className="lab-background-control"
                    onBlur={(event) => {
                      if (!event.currentTarget.contains(event.relatedTarget))
                        setBackgroundMenu(false);
                    }}
                  >
                    <Tool
                      icon="background"
                      label={labels.background}
                      active={!!state.get('surface')}
                      expanded={backgroundMenu}
                      onClick={() => {
                        setBackgroundMenu(!backgroundMenu);
                      }}
                    />
                    {backgroundMenu && (
                      <div
                        className="lab-background-menu"
                        style={backgroundPosition}
                        role="menu"
                        aria-label={labels.background}
                      >
                        {[
                          ['', labels.defaultBackground],
                          ['light', labels.lightBackground],
                          ['dark', labels.darkBackground],
                        ].map(([value, label]) => (
                          <button
                            key={value}
                            role="menuitemradio"
                            aria-checked={
                              (state.get('surface') ?? '') === value
                            }
                            onClick={() => {
                              update({ surface: value });
                              setBackgroundMenu(false);
                            }}
                          >
                            <span
                              className={`lab-color-swatch lab-color-${value || 'default'}`}
                            />
                            {label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <ViewportControl
                    state={state}
                    locale={locale}
                    update={update}
                  />
                  <Tool
                    icon="outline"
                    label={labels.outline}
                    active={state.get('outline') === '1'}
                    onClick={() => {
                      update({
                        outline: state.get('outline') === '1' ? '' : '1',
                      });
                    }}
                  />
                  <Tool
                    icon="measure"
                    label={labels.measure}
                    active={state.get('measure') === '1'}
                    onClick={() => {
                      update({
                        measure: state.get('measure') === '1' ? '' : '1',
                      });
                    }}
                  />
                  {Object.entries(config.globalTypes ?? {}).map(
                    ([key, control]) => (
                      <label className="lab-global-control" key={key}>
                        <span>{text(control.label, locale) || key}</span>
                        <ControlInput
                          control={control}
                          value={globals[key]}
                          label={text(control.label, locale) || key}
                          onChange={(value) => {
                            updateGlobals({ [key]: value });
                          }}
                        />
                      </label>
                    ),
                  )}
                  {extensionTools.map((tool) => (
                    <label className="lab-global-control" key={tool.id}>
                      <span>{text(tool.title, locale)}</span>
                      {tool.options ? (
                        <select
                          aria-label={text(tool.title, locale)}
                          value={controlText(globals[tool.global] ?? '')}
                          onChange={(event) => {
                            updateGlobals({
                              [tool.global]: tool.options?.find(
                                (option) =>
                                  String(option) === event.target.value,
                              ),
                            });
                          }}
                        >
                          {tool.options.map((option) => (
                            <option key={option} value={String(option)}>
                              {option}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          type="checkbox"
                          aria-label={text(tool.title, locale)}
                          checked={Boolean(globals[tool.global])}
                          onChange={(event) => {
                            updateGlobals({
                              [tool.global]: event.target.checked,
                            });
                          }}
                        />
                      )}
                    </label>
                  ))}
                </div>
                <div className="lab-tool-group lab-toolbar-end">
                  <a
                    className="lab-icon-button"
                    title={labels.open}
                    aria-label={labels.open}
                    href={frame}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <Icon name="external" />
                  </a>
                  <div className="lab-zoom">
                    <Tool
                      icon="minus"
                      label={labels.zoomOut}
                      disabled={zoom <= 0.5}
                      onClick={() => {
                        update({
                          zoom: String(Math.round((zoom - 0.1) * 10) / 10),
                        });
                      }}
                    />
                    <button
                      title={labels.zoomReset}
                      aria-label={labels.zoomReset}
                      onClick={() => {
                        update({ zoom: '1' });
                      }}
                    >
                      {Math.round(zoom * 100)}%
                    </button>
                    <Tool
                      icon="plus"
                      label={labels.zoomIn}
                      disabled={zoom >= 2}
                      onClick={() => {
                        update({
                          zoom: String(Math.round((zoom + 0.1) * 10) / 10),
                        });
                      }}
                    />
                  </div>
                  <Tool
                    icon="fullscreen"
                    label={labels.fullscreen}
                    active={fullscreen}
                    onClick={() => {
                      void (async () => {
                        setFullscreenError(false);
                        try {
                          if (document.fullscreenElement)
                            await document.exitFullscreen();
                          else
                            await document.documentElement.requestFullscreen();
                        } catch {
                          setFullscreenError(true);
                        }
                      })();
                    }}
                  />
                  {current.kind === 'examples' &&
                    !!current.examples?.length && (
                      <Tool
                        icon="controls"
                        label={labels.showProps}
                        active={canvas && panel === 'props'}
                        onClick={() => {
                          update({
                            example: example || (current.examples?.[0] ?? ''),
                            panel: canvas && panel === 'props' ? '' : 'props',
                          });
                        }}
                      />
                    )}
                  <Tool
                    icon="code"
                    label={labels.showCode}
                    active={panel === 'code'}
                    onClick={() => {
                      update({
                        ...(current.kind === 'examples'
                          ? {
                              example: example || (current.examples?.[0] ?? ''),
                            }
                          : {}),
                        panel: panel === 'code' ? '' : 'code',
                      });
                    }}
                  />
                  {current.kind === 'examples' && (
                    <>
                      <Tool
                        icon="events"
                        label={labels.actions}
                        active={panel === 'actions'}
                        onClick={() => {
                          openPanel('actions');
                        }}
                      />
                      <Tool
                        icon="play"
                        label={labels.interactions}
                        active={panel === 'interactions'}
                        onClick={() => {
                          openPanel('interactions');
                        }}
                      />
                      <div
                        ref={panelsAnchor}
                        className="lab-panels-control"
                        onBlur={(event) => {
                          if (
                            !event.currentTarget.contains(event.relatedTarget)
                          )
                            setPanelsMenu(false);
                        }}
                      >
                        <Tool
                          icon="panels"
                          label={labels.panels}
                          expanded={panelsMenu}
                          onClick={() => {
                            setPanelsMenu(!panelsMenu);
                          }}
                        />
                        {panelsMenu && (
                          <div
                            className="lab-panels-menu"
                            style={panelsPosition}
                            role="menu"
                            aria-label={labels.panels}
                          >
                            {panels.map((item) => (
                              <button
                                role="menuitemradio"
                                key={item.id}
                                aria-checked={panel === item.id}
                                onClick={() => {
                                  openPanel(item.id);
                                }}
                              >
                                {typeof item.title === 'string'
                                  ? item.title
                                  : text(item.title, locale)}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </div>
              </>
            )}
            <div className="lab-reading-tools">
              <label className="lab-language">
                <span className="lab-sr-only">{labels.language}</span>
                <select
                  value={locale}
                  onChange={(event) => {
                    update({ locale: event.target.value });
                  }}
                >
                  {Object.entries(i18n.registry.locales).map(([tag, info]) => (
                    <option key={tag} value={tag}>
                      {info.name}
                      {info.status === 'draft' ? ` · ${labels.draft}` : ''}
                    </option>
                  ))}
                </select>
              </label>
              <button
                className="lab-theme-toggle"
                role="switch"
                aria-checked={theme === 'dark'}
                aria-label={labels.theme}
                title={theme === 'dark' ? labels.light : labels.dark}
                onClick={() => {
                  update({ theme: theme === 'dark' ? 'light' : 'dark' });
                }}
              >
                <Icon name="sun" />
                <Icon name="moon" />
              </button>
            </div>
          </header>
          {fullscreenError && (
            <div className="lab-toolbar-error" role="alert">
              {labels.fullscreenError}
              <button
                aria-label={labels.dismiss}
                onClick={() => {
                  setFullscreenError(false);
                }}
              >
                ×
              </button>
            </div>
          )}
          <main
            className={`lab-main ${playground && viewportDimensions(state) ? 'lab-mobile-viewport' : ''}`}
          >
            <ViewportFrame
              state={playground ? state : new URLSearchParams()}
              update={update}
              locale={locale}
            >
              <iframe
                ref={iframe}
                data-i18n-locale={locale}
                data-i18n-resources={JSON.stringify(i18n.resources)}
                key={generation}
                className="lab-content-frame"
                src={frame}
                title={pageTitle}
              />
            </ViewportFrame>
          </main>
        </div>
      </div>
    </>
  );
}
const root = document.getElementById('root');
if (!root) throw new Error('Space Lab: root element is missing.');
void mountLocalized(root, App).catch((error: unknown) => {
  root.textContent = String(error);
});
