import type { Result, NodeResult } from 'axe-core';
import type { ScenarioSnapshot } from './scenario.js';

export interface AccessibilityReport {
  violations: (Pick<Result, 'id' | 'impact' | 'help'> & {
    nodes: Pick<NodeResult, 'html' | 'target'>[];
  })[];
  incomplete: number;
  passed: number;
}

export interface PreviewTestState {
  ready?: boolean;
  page?: string;
  example?: string;
  scenario?: ScenarioSnapshot;
  error?: string;
}

declare global {
  interface Window {
    __SPACE_LAB_TEST__?: PreviewTestState;
    // eslint-disable-next-line @typescript-eslint/naming-convention -- This existing cross-frame protocol key must match the browser runner.
    __SPACE_LAB_A11Y__?: () => Promise<AccessibilityReport>;
  }
}
