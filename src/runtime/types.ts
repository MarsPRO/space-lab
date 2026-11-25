import type { ReactNode } from 'react';
import type { Text, Control, ExampleContext } from '../index.js';
export interface ApiProp {
  name: string;
  type: string;
  required: boolean;
  description: string;
  defaultValue?: string;
  control?: Control;
}
export interface GlobalDefinition extends Control {
  defaultValue?: unknown;
}
export type Loader = (
  context: ExampleContext & {
    args: Record<string, unknown>;
    signal: AbortSignal;
  },
) => Record<string, unknown> | Promise<Record<string, unknown>>;
export interface PlayContext extends ExampleContext {
  canvasElement: HTMLElement;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Play callbacks consume arbitrary consumer-defined props.
  args: Record<string, any>;
  signal: AbortSignal;
  step(name: string, run: () => unknown): Promise<void>;
}
export type PlayFunction = (context: PlayContext) => unknown;
export interface PanelContext extends ExampleContext {
  args: Record<string, unknown>;
  updateArgs(values: Record<string, unknown>): void;
  resetArgs(): void;
}
export interface ExtensionPanel {
  id: string;
  title: Text;
  render(context: PanelContext): ReactNode;
}
export interface ExtensionTool {
  id: string;
  title: Text;
  global: string;
  options?: (string | number)[];
}
export interface Renderer {
  mount(
    container: HTMLElement,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Renderer adapters consume arbitrary consumer-defined props.
    args: Record<string, any>,
    context: ExampleContext,
    // eslint-disable-next-line @typescript-eslint/no-invalid-void-type -- Mount accepts sync or async optional cleanup callbacks.
  ): void | (() => void) | Promise<void | (() => void)>;
  update?(
    container: HTMLElement,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Renderer adapters consume arbitrary consumer-defined props.
    args: Record<string, any>,
    context: ExampleContext,
  ): void;
}
export interface Viewport {
  name: Text;
  width: number;
  height: number;
}
