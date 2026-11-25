import { within, waitFor } from '@testing-library/dom';
import { userEvent } from '@testing-library/user-event';
import type { PlayContext, PlayFunction } from './types.js';
export { within, waitFor, userEvent };
export function assert(
  condition: unknown,
  message = 'Assertion failed',
): asserts condition {
  if (!condition) throw new Error(message);
}
export interface StepResult {
  name: string;
  status: 'running' | 'passed' | 'failed';
  duration?: number;
  error?: string;
}
export interface ScenarioSnapshot {
  status: 'idle' | 'running' | 'paused' | 'passed' | 'failed' | 'stopped';
  steps: StepResult[];
  error?: string;
}
export class ScenarioRunner {
  private snapshot: ScenarioSnapshot = { status: 'idle', steps: [] };
  private listeners = new Set<() => void>();
  private controller: AbortController | null = null;
  private gate: (() => void) | null = null;
  private pauseAtStep = false;
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(values: Partial<ScenarioSnapshot>) {
    this.snapshot = { ...this.snapshot, ...values };
    for (const listener of this.listeners) listener();
  }
  pause() {
    this.pauseAtStep = true;
  }
  resume() {
    this.pauseAtStep = false;
    this.gate?.();
    this.gate = null;
  }
  next() {
    this.pauseAtStep = true;
    this.gate?.();
    this.gate = null;
  }
  stop() {
    this.controller?.abort();
    this.resume();
    if (this.snapshot.status === 'running' || this.snapshot.status === 'paused')
      this.publish({ status: 'stopped' });
  }
  async run(
    play: PlayFunction,
    context: Omit<PlayContext, 'signal' | 'step'>,
    paused = false,
  ) {
    this.stop();
    const controller = new AbortController();
    this.controller = controller;
    this.pauseAtStep = paused;
    this.publish({ status: 'running', steps: [], error: undefined });
    const clipboard =
      typeof navigator !== 'undefined'
        ? Object.getOwnPropertyDescriptor(navigator, 'clipboard')
        : undefined;
    try {
      await play({
        ...context,
        signal: controller.signal,
        step: async (name, execute) => {
          if (controller.signal.aborted)
            throw new DOMException('Stopped', 'AbortError');
          if (this.pauseAtStep) {
            this.publish({ status: 'paused' });
            await new Promise<void>((resolve) => {
              this.gate = resolve;
            });
            // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- AbortSignal can change during the awaited pause despite TypeScript's earlier narrowing.
            if (controller.signal.aborted)
              throw new DOMException('Stopped', 'AbortError');
          }
          const step: StepResult = { name, status: 'running' };
          const start = performance.now();
          this.publish({
            status: 'running',
            steps: [...this.snapshot.steps, step],
          });
          try {
            await execute();
            step.status = 'passed';
          } catch (error) {
            step.status = 'failed';
            step.error = error instanceof Error ? error.message : String(error);
            throw error;
          } finally {
            step.duration = Math.round(performance.now() - start);
            if (this.controller === controller)
              this.publish({ steps: [...this.snapshot.steps] });
          }
        },
      });
      if (this.controller === controller)
        this.publish({
          status: controller.signal.aborted ? 'stopped' : 'passed',
        });
    } catch (error) {
      if (this.controller === controller)
        this.publish({
          status: controller.signal.aborted ? 'stopped' : 'failed',
          error: error instanceof Error ? error.message : String(error),
        });
    } finally {
      if (typeof navigator !== 'undefined') {
        if (clipboard) Object.defineProperty(navigator, 'clipboard', clipboard);
        else delete (navigator as { clipboard?: Clipboard }).clipboard;
      }
    }
  }
}
