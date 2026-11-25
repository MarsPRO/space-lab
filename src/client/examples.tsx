import {
  Component,
  createElement,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import type { ReactNode } from 'react';
import { CodeBlock } from './code.js';
import type {
  ComponentDocumentation,
  ExampleContext,
  PlayContext,
  Renderer,
} from '../index.js';
import {
  useLocale,
  useTheme,
  useDecorators,
  useGlobals,
  usePreview,
  useSite,
  ArgsProvider,
  useLabels,
  useText,
} from '../react.js';
import { readState, updatePreviewState } from './shared.js';
import { ControlInput, controlVisible } from './controls.js';
import { argsFromUrl, argsToUrl } from '../runtime/url.js';
import { resolveRoute } from '../runtime/routes.js';
import {
  action,
  getActions,
  subscribeActions,
  serializable,
} from '../runtime/actions.js';
import { ScenarioRunner } from '../runtime/scenario.js';
import { Inspector } from './inspector.js';
import {
  ActionsPanel,
  Diagnostic,
  ApiTable,
  ScenarioPanel,
  AccessibilityPanel,
  VisualPanel,
} from './panels.js';
import { useDocumentation } from './definition.js';
import type { RuntimeDocumentation } from './definition.js';
import { asRecord } from '../runtime/data.js';

export class ErrorBoundary extends Component<
  { children: ReactNode; label: string; resetKey?: string },
  { error: string | null }
> {
  state = { error: null as string | null };
  static getDerivedStateFromError(error: Error) {
    return { error: error.message };
  }
  componentDidUpdate(previous: Readonly<{ resetKey?: string }>) {
    if (this.state.error && previous.resetKey !== this.props.resetKey)
      this.setState({ error: null });
  }
  render(): ReactNode {
    return this.state.error ? (
      <div role="alert" className="lab-error">
        <strong>{this.props.label}</strong>
        <pre>{this.state.error}</pre>
      </div>
    ) : (
      this.props.children
    );
  }
}
export function exampleSource(
  definition: RuntimeDocumentation,
  example: RuntimeDocumentation['examples'][string],
  args: Record<string, unknown>,
): string {
  const source = example.source ?? definition.source;
  if (source) return typeof source === 'function' ? source(args) : source;
  const name =
    definition.componentName ??
    definition.component?.displayName ??
    'Component';
  const attributes = Object.entries(args)
    .filter(
      ([, value]) =>
        value !== undefined &&
        (typeof value !== 'function' || 'actionName' in value),
    )
    .map(
      ([key, value]) =>
        `${key}={${typeof value === 'function' && 'actionName' in value ? `action(${JSON.stringify(value.actionName)})` : JSON.stringify(value)}}`,
    )
    .join(' ');
  return `<${name}${attributes ? ' ' + attributes : ''} />`;
}
function MountedExample({
  renderer,
  args,
  context,
  onReady,
}: {
  renderer: Renderer;
  args: Record<string, unknown>;
  context: ExampleContext;
  onReady: (ready: boolean) => void;
}) {
  const container = useRef<HTMLDivElement>(null),
    latest = useRef({ args, context }),
    mounted = useRef(false);
  const [error, setError] = useState('');
  latest.current = { args, context };
  const fingerprint = JSON.stringify(serializable({ args, context }));
  useEffect(() => {
    let active = true,
      dispose: undefined | (() => void);
    const element = container.current;
    if (!element) return;
    mounted.current = false;
    onReady(false);
    element.dataset.rendererReady = 'false';
    element.replaceChildren();
    Promise.resolve(
      renderer.mount(element, latest.current.args, latest.current.context),
    )
      .then((cleanup) => {
        dispose = cleanup ?? undefined;
        if (!active) cleanup?.();
        else {
          mounted.current = true;
          renderer.update?.(
            element,
            latest.current.args,
            latest.current.context,
          );
          element.dataset.rendererReady = 'true';
          onReady(true);
        }
      })
      .catch((error: unknown) => {
        if (active) setError(String(error));
      });
    return () => {
      active = false;
      mounted.current = false;
      dispose?.();
      element.replaceChildren();
    };
  }, [renderer, renderer.update ? '' : fingerprint]);
  useEffect(() => {
    if (mounted.current && container.current)
      renderer.update?.(container.current, args, context);
  }, [fingerprint]);
  if (error) throw new Error(error);
  return <div className="lab-renderer-host" ref={container} />;
}
function LiveExample({
  definition,
  example,
  args,
  context,
  onReady,
}: {
  definition: RuntimeDocumentation;
  example: RuntimeDocumentation['examples'][string];
  args: Record<string, unknown>;
  context: ExampleContext;
  onReady: (ready: boolean) => void;
}) {
  const decorators = useDecorators(),
    render = example.render ?? definition.render;
  const renderer = example.renderer ?? definition.renderer;
  let node = renderer ? (
    <MountedExample
      renderer={renderer}
      args={args}
      context={context}
      onReady={onReady}
    />
  ) : render ? (
    render(args, context)
  ) : definition.component ? (
    createElement(definition.component, args)
  ) : null;
  for (const decorator of decorators) node = decorator(node, context);
  return node;
}
export interface StageOptions {
  panel: string;
  grid: boolean;
  outline: boolean;
  surface: string;
  zoom: number;
}
function ExampleBlock({
  definition,
  exampleKey,
  stage,
}: {
  definition: RuntimeDocumentation;
  exampleKey: string;
  stage?: StageOptions;
}) {
  const locale = useLocale(),
    theme = useTheme(),
    [globals] = useGlobals(),
    preview = usePreview();
  const { entries } = useSite();
  const text = useText();
  const labels = useLabels(),
    example = definition.examples[exampleKey];
  const page = resolveRoute(entries, readState().get('page'))?.id ?? '',
    identity = stage
      ? exampleKey
      : `${text(definition.title, 'en')}:${exampleKey}`;
  const base = useMemo(() => {
    const defaults = asRecord(definition.args);
    const values = { ...defaults, ...example.args };
    for (const prop of definition.api ?? [])
      if (
        values[prop.name] === undefined &&
        /=>|Function/.test(prop.type) &&
        /^on[A-Z]/.test(prop.name)
      )
        values[prop.name] = action(prop.name);
    return values;
  }, [definition, example]);
  const decode = (values: Record<string, unknown>) =>
    Object.fromEntries(
      Object.entries(values).map(([key, value]) => {
        const control =
          definition.controls && Object.hasOwn(definition.controls, key)
            ? definition.controls[key]
            : undefined;
        const mapping = control?.mapping;
        return [
          key,
          typeof value === 'string' && mapping && Object.hasOwn(mapping, value)
            ? mapping[value]
            : value,
        ];
      }),
    );
  const [args, setArgs] = useState<Record<string, unknown>>(() => ({
    ...base,
    ...decode(argsFromUrl(readState(), page, identity, entries)),
  }));
  const [reset, setReset] = useState(0),
    [copy, setCopy] = useState<'copied' | 'failed' | ''>(''),
    [showCode, setShowCode] = useState(false);
  const [inlinePanel, setInlinePanel] = useState('props');
  const lastArgs = useRef(readState().get('args'));
  const canvas = useRef<HTMLDivElement>(null);
  const runner = useMemo(() => new ScenarioRunner(), []);
  const events = useSyncExternalStore(subscribeActions, getActions, getActions);
  const [load, setLoad] = useState<{
    key: string;
    data: Record<string, unknown>;
    error?: string;
  }>({ key: '', data: {} });
  const [rendererReady, setRendererReady] = useState(
    !(example.renderer ?? definition.renderer),
  );
  const loaders = [
    ...(preview.loaders ?? []),
    ...(definition.loaders ?? []),
    ...(example.loaders ?? []),
  ];
  const loadKey = JSON.stringify(
    serializable({ args, locale, theme, globals, reset }),
  );
  const loadReady = !loaders.length || load.key === loadKey;
  const ready =
    loadReady && (!(example.renderer ?? definition.renderer) || rendererReady);
  const context: ExampleContext = {
    locale,
    theme,
    globals,
    loaded: loadReady ? load.data : {},
  };
  const play = example.play ?? definition.play;
  const played = useRef('');
  function persist(values: Record<string, unknown>) {
    try {
      const encoded = Object.fromEntries(
        Object.entries(values).map(([key, value]) => {
          const mapping = definition.controls?.[key]?.mapping;
          return [
            key,
            mapping
              ? (Object.keys(mapping).find((option) =>
                  Object.is(mapping[option], value),
                ) ?? value)
              : value,
          ];
        }),
      );
      const token = argsToUrl(page, identity, encoded);
      if (token.length > 100_000) return;
      lastArgs.current = token;
      updatePreviewState({ args: token }, true);
    } catch {
      /* Несериализуемые значения продолжают работать в текущем примере. */
    }
  }
  const updateArgs = (values: Record<string, unknown>) => {
    setArgs((previous) => {
      const next = { ...previous, ...values };
      queueMicrotask(() => {
        persist(next);
      });
      return next;
    });
  };
  const resetArgs = () => {
    runner.stop();
    setArgs({ ...base });
    setReset((value) => value + 1);
    persist({});
  };
  useEffect(() => {
    const restore = () => {
      const token = readState().get('args');
      if (token !== lastArgs.current) {
        lastArgs.current = token;
        const record = argsFromUrl(readState(), page, identity, entries);
        setArgs({ ...base, ...decode(record) });
      }
    };
    window.addEventListener('hashchange', restore);
    return () => {
      window.removeEventListener('hashchange', restore);
    };
  }, [base, page, identity]);
  useEffect(() => {
    const controller = new AbortController();
    if (loaders.length) {
      void (async () => {
        let data: Record<string, unknown> = {};
        try {
          for (const loader of loaders) {
            if (controller.signal.aborted) return;
            data = {
              ...data,
              ...(await loader({
                ...context,
                loaded: data,
                args,
                signal: controller.signal,
              })),
            };
          }
          if (!controller.signal.aborted) setLoad({ key: loadKey, data });
        } catch (error) {
          if (!controller.signal.aborted)
            setLoad({ key: loadKey, data: {}, error: String(error) });
        }
      })();
    }
    return () => {
      controller.abort();
    };
  }, [loadKey]);
  useEffect(
    () => () => {
      runner.stop();
    },
    [runner],
  );
  const playContext = (): Omit<PlayContext, 'signal' | 'step'> | null =>
    canvas.current && ready
      ? { ...context, args, canvasElement: canvas.current }
      : null;
  useEffect(() => {
    const report = () => {
      window.__SPACE_LAB_TEST__ = {
        ready,
        page,
        example: exampleKey,
        scenario: runner.getSnapshot(),
        error: load.error,
      };
    };
    const unsubscribe = runner.subscribe(report);
    window.__SPACE_LAB_A11Y__ = async () => {
      const { default: axe } = await import('axe-core');
      const element = canvas.current;
      if (!element)
        throw new Error('Space Lab: example canvas is unavailable.');
      const result = await axe.run(element, {
        runOnly: {
          type: 'tag',
          values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'],
        },
        resultTypes: ['violations', 'incomplete', 'passes'],
      });
      return {
        violations: result.violations.map(({ id, impact, help, nodes }) => ({
          id,
          impact,
          help,
          nodes: nodes.map(({ html, target }) => ({ html, target })),
        })),
        incomplete: result.incomplete.length,
        passed: result.passes.length,
      };
    };
    report();
    if (
      ready &&
      !load.error &&
      play &&
      (readState().get('test') === '1' ||
        readState().get('autoplay') === '1') &&
      played.current !== String(reset)
    ) {
      played.current = String(reset);
      const value = playContext();
      if (value) void runner.run(play, value);
    }
    return unsubscribe;
  }, [loadKey, ready, play, load.error]);
  const source = exampleSource(definition, example, args);
  const copySource = async () => {
    try {
      await navigator.clipboard.writeText(source);
      setCopy('copied');
    } catch {
      setCopy('failed');
    }
  };
  const copyStatus =
    copy === 'copied'
      ? labels.copied
      : copy === 'failed'
        ? labels.copyFailed
        : '';
  const controls = definition.controls ? (
    <div className="lab-table-scroll">
      <table className="lab-controls">
        <caption className="lab-sr-only">{labels.props}</caption>
        <thead>
          <tr>
            <th>{labels.property}</th>
            <th>{labels.value}</th>
            <th>{labels.description}</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(definition.controls).map(
            ([key, control]) =>
              control &&
              controlVisible(control, args, globals) && (
                <tr key={key}>
                  <th scope="row">
                    <code>{text(control.label, locale) || key}</code>
                  </th>
                  <td>
                    <ControlInput
                      key={`${key}-${String(reset)}`}
                      control={control}
                      value={args[key]}
                      label={`${text(example.name, locale) || exampleKey}: ${text(control.label, locale) || key}`}
                      onChange={(value) => {
                        updateArgs({ [key]: value });
                      }}
                    />
                  </td>
                  <td>{text(control.description, locale)}</td>
                </tr>
              ),
          )}
        </tbody>
      </table>
    </div>
  ) : (
    <p className="lab-muted">{labels.noProps}</p>
  );
  const panelContext = { ...context, args, updateArgs, resetArgs };
  const pageId = entries.find(
    (entry) =>
      entry.kind === 'examples' &&
      JSON.stringify(entry.title) === JSON.stringify(definition.title),
  )?.id;
  const tabs = [
    {
      id: 'props',
      title: labels.props,
      count: Object.keys(definition.controls ?? {}).length,
      content: controls,
    },
    {
      id: 'code',
      title: labels.code,
      content: <CodeBlock code={source} />,
    },
    {
      id: 'actions',
      title: labels.actions,
      count: events.length,
      content: <ActionsPanel />,
    },
    {
      id: 'interactions',
      title: labels.interactions,
      content: (
        <ScenarioPanel
          runner={runner}
          play={play}
          context={playContext}
          ready={ready}
        />
      ),
    },
    {
      id: 'api',
      title: labels.api,
      content: <ApiTable props={definition.api ?? []} />,
    },
    {
      id: 'a11y',
      title: labels.accessibility,
      content: <AccessibilityPanel canvas={() => canvas.current} />,
    },
    ...(pageId
      ? [
          {
            id: 'visual',
            title: labels.visual,
            content: (
              <VisualPanel
                pageId={pageId}
                example={exampleKey}
                args={args}
                context={context}
              />
            ),
          },
        ]
      : []),
    ...(preview.panels ?? [])
      .filter(
        (panel) =>
          ![
            'props',
            'code',
            'actions',
            'interactions',
            'api',
            'a11y',
            'visual',
          ].includes(panel.id),
      )
      .map((panel) => ({
        id: panel.id,
        title: text(panel.title, locale),
        content: panel.render(panelContext),
      })),
  ];
  const live = !loadReady ? (
    <p role="status">{labels.loading}</p>
  ) : load.error ? (
    <Diagnostic summary={labels.error} details={load.error} />
  ) : (
    <ArgsProvider
      value={{ values: args, update: updateArgs, reset: resetArgs, context }}
    >
      <ErrorBoundary label={labels.error} resetKey={loadKey}>
        <LiveExample
          key={reset}
          definition={definition}
          example={example}
          args={args}
          context={context}
          onReady={setRendererReady}
        />
      </ErrorBoundary>
    </ArgsProvider>
  );
  const inspectorActions = (
    <>
      <span role="status">{copyStatus}</span>
      <button onClick={resetArgs}>{labels.reset}</button>
      <button
        onClick={() => {
          void copySource();
        }}
      >
        {labels.copy}
      </button>
    </>
  );
  if (stage)
    return (
      <section
        className={`lab-standalone ${stage.panel ? 'has-panel' : ''}`}
        aria-label={text(example.name, locale) || exampleKey}
        data-surface={stage.surface}
        data-grid={stage.grid}
        data-panel-dock={readState().get('dock') ?? 'bottom'}
        style={
          {
            '--lab-panel-size': `${String(Math.max(160, Number(readState().get('panelSize')) || (readState().get('dock') === 'right' ? 420 : 310)))}px`,
          } as React.CSSProperties
        }
      >
        <div
          ref={canvas}
          className="lab-live-area"
          data-ready={ready && !load.error}
          data-outline={stage.outline}
          style={{ zoom: stage.zoom }}
        >
          {live}
        </div>
        {stage.panel && (
          <Inspector
            tabs={tabs}
            active={stage.panel}
            actions={inspectorActions}
          />
        )}
      </section>
    );
  return (
    <section
      className="lab-example"
      aria-label={text(example.name, locale) || exampleKey}
    >
      <div className="lab-example-heading">
        <h3>{text(example.name, locale) || exampleKey}</h3>
        <button onClick={resetArgs}>{labels.reset}</button>
      </div>
      {example.description && <p>{text(example.description, locale)}</p>}
      <div
        ref={canvas}
        className="lab-canvas lab-live-area"
        data-ready={ready && !load.error}
      >
        {live}
      </div>
      <div className="lab-example-tools">
        <button
          aria-expanded={showCode}
          onClick={() => {
            setShowCode(!showCode);
          }}
        >
          {labels.code}
        </button>
        <button
          onClick={() => {
            void copySource();
          }}
        >
          {labels.copy}
        </button>
        <span role="status">{copyStatus}</span>
      </div>
      {showCode && <CodeBlock code={source} />}
      <div
        className="lab-inline-tabs"
        role="tablist"
        aria-label={labels.panels}
      >
        {tabs
          .filter((tab) => tab.id !== 'code')
          .map((tab) => (
            <button
              key={tab.id}
              role="tab"
              aria-selected={inlinePanel === tab.id}
              onClick={() => {
                setInlinePanel(tab.id);
              }}
            >
              {tab.title}
            </button>
          ))}
      </div>
      <div role="tabpanel">
        {tabs.find((tab) => tab.id === inlinePanel)?.content}
      </div>
    </section>
  );
}
export function StandaloneExample({
  definition,
  example,
  stage,
}: {
  definition: RuntimeDocumentation;
  example: string;
  stage: StageOptions;
}) {
  const enriched = useDocumentation(definition);
  const labels = useLabels();
  const examples: Partial<RuntimeDocumentation['examples']> =
    definition.examples;
  if (!examples[example]) return <p role="alert">{labels.notFound}</p>;
  return (
    <ExampleBlock
      key={example}
      definition={enriched}
      exampleKey={example}
      stage={stage}
    />
  );
}
export function Canvas<Props>({
  of,
  example,
}: {
  of: ComponentDocumentation<Props>;
  example?: string;
}) {
  const definition = useDocumentation(of);
  const labels = useLabels(),
    key = example ?? Object.keys(of.examples)[0];
  const examples: Partial<RuntimeDocumentation['examples']> = of.examples;
  if (!key || !examples[key]) return <p role="alert">{labels.notFound}</p>;
  return <ExampleBlock key={key} definition={definition} exampleKey={key} />;
}
export function ExamplesPage({
  definition,
}: {
  definition: RuntimeDocumentation;
}) {
  const locale = useLocale();
  const labels = useLabels();
  const text = useText();
  return (
    <>
      <p className="lab-eyebrow">{labels.components}</p>
      <h1>{text(definition.title, locale).split('/').pop()}</h1>
      {definition.description && (
        <p className="lab-lead">{text(definition.description, locale)}</p>
      )}
      {!!definition.api?.length && (
        <>
          <h2>{labels.api}</h2>
          <ApiTable props={definition.api} />
        </>
      )}
      {Object.entries(definition.subcomponentApi ?? {}).map(([name, props]) => (
        <section key={name}>
          <h2>{name}</h2>
          <ApiTable props={props} />
        </section>
      ))}
      <h2>{labels.examples}</h2>
      {Object.keys(definition.examples).map((key) => (
        <Canvas key={key} of={definition} example={key} />
      ))}
    </>
  );
}
