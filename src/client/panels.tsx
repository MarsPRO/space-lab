import { useState, useSyncExternalStore } from 'react';
import type { AxeResults } from 'axe-core';
import type { CaptureResult } from '../node/visual.js';
import { asRecord } from '../runtime/data.js';
import type { ApiProp, PlayContext, PlayFunction } from '../index.js';
import { useLabels, useSite, useI18n } from '../react.js';
import {
  clearActions,
  getActions,
  subscribeActions,
} from '../runtime/actions.js';
import { ScenarioRunner } from '../runtime/scenario.js';
import { argsToUrl } from '../runtime/url.js';
import type { ExampleContext } from '../index.js';

export function Diagnostic({
  summary,
  details,
}: {
  summary: string;
  details: string;
}) {
  return (
    <div role="alert" className="lab-error">
      <strong>{summary}</strong>
      <pre dir="ltr">{details}</pre>
    </div>
  );
}
export function ActionsPanel() {
  const labels = useLabels(),
    entries = useSyncExternalStore(subscribeActions, getActions, getActions);
  const i18n = useI18n();
  const [query, setQuery] = useState(''),
    [copied, setCopied] = useState<'copied' | 'failed' | ''>('');
  const filtered = entries.filter((entry) =>
    `${entry.name} ${JSON.stringify(entry.args)}`
      .toLocaleLowerCase()
      .includes(query.toLocaleLowerCase()),
  );
  return (
    <div className="lab-events">
      <div className="lab-panel-tools">
        <input
          type="search"
          aria-label={labels.filterEvents}
          placeholder={labels.filterEvents}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
          }}
        />
        <button onClick={clearActions}>{labels.clear}</button>
        <button
          onClick={() => {
            void (async () => {
              try {
                await navigator.clipboard.writeText(
                  JSON.stringify(filtered, null, 2),
                );
                setCopied('copied');
              } catch {
                setCopied('failed');
              }
            })();
          }}
        >
          {labels.exportEvents}
        </button>
        {copied && (
          <span role="status">
            {copied === 'copied' ? labels.copied : labels.copyFailed}
          </span>
        )}
      </div>
      {!filtered.length && <p className="lab-muted">{labels.noEvents}</p>}
      {filtered.map((entry) => (
        <details
          key={entry.id}
          className="lab-event"
          data-event-name={entry.name}
        >
          <summary>
            <time>
              {i18n.date(new Date(entry.timestamp), {
                timeZone: 'UTC',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                fractionalSecondDigits: 3,
              })}
            </time>
            <strong>{entry.name}</strong>
            <code>{JSON.stringify(entry.args)}</code>
          </summary>
          <pre>{JSON.stringify(entry.args, null, 2)}</pre>
        </details>
      ))}
    </div>
  );
}
export function ApiTable({ props }: { props: ApiProp[] }) {
  const labels = useLabels();
  if (!props.length) return <p className="lab-muted">{labels.noApi}</p>;
  return (
    <div className="lab-table-scroll">
      <table className="lab-api-table">
        <thead>
          <tr>
            <th>{labels.property}</th>
            <th>{labels.type}</th>
            <th>{labels.defaultValue}</th>
            <th>{labels.description}</th>
          </tr>
        </thead>
        <tbody>
          {props.map((prop) => (
            <tr key={prop.name}>
              <th scope="row">
                <code>{prop.name}</code>
                <small>
                  {prop.required ? labels.required : labels.optional}
                </small>
              </th>
              <td>
                <code>{prop.type}</code>
              </td>
              <td>
                <code>{prop.defaultValue ?? '—'}</code>
              </td>
              <td>{prop.description}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
export function ScenarioPanel({
  runner,
  play,
  context,
  ready = true,
}: {
  runner: ScenarioRunner;
  play?: PlayFunction;
  context: () => Omit<PlayContext, 'signal' | 'step'> | null;
  ready?: boolean;
}) {
  const labels = useLabels(),
    snapshot = useSyncExternalStore(
      runner.subscribe,
      runner.getSnapshot,
      runner.getSnapshot,
    );
  const number = new Intl.NumberFormat(useI18n().locale);
  if (!play) return <p className="lab-muted">{labels.noScenario}</p>;
  const active = snapshot.status === 'running' || snapshot.status === 'paused';
  return (
    <div className="lab-scenario">
      <div className="lab-panel-tools">
        <button
          disabled={active || !ready}
          onClick={() => {
            const value = context();
            if (value) void runner.run(play, value);
          }}
        >
          {labels.run}
        </button>
        <button
          disabled={active || !ready}
          onClick={() => {
            const value = context();
            if (value) void runner.run(play, value, true);
          }}
        >
          {labels.runPaused}
        </button>
        <button
          disabled={snapshot.status !== 'running'}
          onClick={() => {
            runner.pause();
          }}
        >
          {labels.pause}
        </button>
        <button
          disabled={snapshot.status !== 'paused'}
          onClick={() => {
            runner.resume();
          }}
        >
          {labels.resume}
        </button>
        <button
          disabled={snapshot.status !== 'paused'}
          onClick={() => {
            runner.next();
          }}
        >
          {labels.nextStep}
        </button>
        <button
          disabled={!active}
          onClick={() => {
            runner.stop();
          }}
        >
          {labels.stop}
        </button>
        <strong role="status" data-scenario-status={snapshot.status}>
          {labels[snapshot.status]}
        </strong>
      </div>
      <ol className="lab-scenario-steps">
        {snapshot.steps.map((step, index) => (
          <li key={index} data-step-status={step.status}>
            <span>{step.name}</span>
            <strong>{labels[step.status]}</strong>
            <small>{number.format(step.duration ?? 0)} ms</small>
            {step.error && (
              <Diagnostic summary={labels.scenarioError} details={step.error} />
            )}
          </li>
        ))}
      </ol>
      {snapshot.error && (
        <Diagnostic summary={labels.scenarioError} details={snapshot.error} />
      )}
    </div>
  );
}
export function AccessibilityPanel({
  canvas,
}: {
  canvas: () => HTMLElement | null;
}) {
  const labels = useLabels();
  const i18n = useI18n();
  const [running, setRunning] = useState(false),
    [result, setResult] = useState<AxeResults | null>(null),
    [error, setError] = useState('');
  return (
    <div className="lab-accessibility">
      <div className="lab-panel-tools">
        <button
          disabled={running}
          onClick={() => {
            void (async () => {
              const element = canvas();
              if (!element) return;
              setRunning(true);
              setError('');
              try {
                const { default: axe } = await import('axe-core');
                setResult(
                  await axe.run(element, {
                    runOnly: {
                      type: 'tag',
                      values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'],
                    },
                    resultTypes: ['violations', 'incomplete', 'passes'],
                  }),
                );
              } catch (error) {
                setError(String(error));
              } finally {
                setRunning(false);
              }
            })();
          }}
        >
          {running ? labels.running : labels.scan}
        </button>
        {result && (
          <span role="status">
            {labels.violations}: {i18n.number(result.violations.length)} ·{' '}
            {labels.incomplete}: {i18n.number(result.incomplete.length)} ·{' '}
            {labels.checksPassed}: {i18n.number(result.passes.length)}
          </span>
        )}
      </div>
      {error && <Diagnostic summary={labels.error} details={error} />}
      {result &&
        [...result.violations, ...result.incomplete].map((issue) => (
          <details key={issue.id} data-rule-id={issue.id}>
            <summary>
              <strong>{issue.id}</strong> · {issue.impact} · {issue.help}
            </summary>
            <a href={issue.helpUrl} target="_blank" rel="noreferrer">
              {issue.description}
            </a>
            {issue.nodes.map((node, index) => (
              <pre key={index}>
                {node.html}
                {'\n'}
                {node.failureSummary}
              </pre>
            ))}
          </details>
        ))}
    </div>
  );
}
export function VisualPanel({
  pageId,
  example,
  args,
  context,
}: {
  pageId: string;
  example: string;
  args: Record<string, unknown>;
  context: ExampleContext;
}) {
  const labels = useLabels();
  const i18n = useI18n();
  const { development } = useSite();
  const [running, setRunning] = useState(false),
    [result, setResult] = useState<
      | (Pick<CaptureResult, 'status' | 'images' | 'diffPixels'> & {
          stamp: number;
        })
      | null
    >(null),
    [error, setError] = useState('');
  if (!development) return <p className="lab-muted">{labels.devOnly}</p>;
  async function run(update: boolean) {
    setRunning(true);
    setError('');
    try {
      const response = await fetch('/__space-lab/visual', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          page: pageId,
          example,
          locale: context.locale,
          theme: context.theme,
          args: argsToUrl(pageId, example, args),
          globals: context.globals,
          update,
          visual: true,
          width: innerWidth,
          height: innerHeight,
        }),
      });
      const value = asRecord(await response.json());
      if (!response.ok)
        throw new Error(
          typeof value.error === 'string' ? value.error : response.statusText,
        );
      const status = value.status;
      if (
        status !== 'passed' &&
        status !== 'changed' &&
        status !== 'missing' &&
        status !== 'updated'
      )
        throw new Error('Space Lab: invalid visual response.');
      const images = Object.fromEntries(
        Object.entries(asRecord(value.images)).flatMap(([key, image]) =>
          typeof image === 'string' ? [[key, image]] : [],
        ),
      );
      setResult({
        status,
        images,
        diffPixels:
          typeof value.diffPixels === 'number' ? value.diffPixels : undefined,
        stamp: Date.now(),
      });
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setRunning(false);
    }
  }
  return (
    <div className="lab-visual">
      <div className="lab-panel-tools">
        <button disabled={running} onClick={() => void run(false)}>
          {labels.compare}
        </button>
        <button disabled={running} onClick={() => void run(true)}>
          {labels.baseline}
        </button>
        {running && <span role="status">{labels.running}</span>}
      </div>
      {error && <Diagnostic summary={labels.error} details={error} />}
      {result && (
        <>
          <p role="status" data-visual-status={result.status}>
            {result.status === 'updated'
              ? labels.baselineSaved
              : result.status === 'missing'
                ? labels.missingBaseline
                : result.status === 'changed'
                  ? labels.visualChanged
                  : labels.passed}
            {result.diffPixels !== undefined &&
              ` · ${labels.pixelDiff}: ${i18n.number(result.diffPixels)}`}
          </p>
          <div className="lab-visual-images">
            {Object.entries(result.images ?? {}).map(([key, value]) => (
              <figure key={`${key}-${String(result.stamp)}`}>
                <figcaption>
                  {{
                    baseline: labels.baselineImage,
                    current: labels.currentImage,
                    diff: labels.diffImage,
                  }[key] ?? key}
                </figcaption>
                <a href={value} target="_blank" rel="noreferrer">
                  <img src={value} alt={key} />
                </a>
              </figure>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
