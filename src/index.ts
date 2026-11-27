import type { ComponentType, ReactNode } from 'react';
import type { Locale, LocalizedText, NavigationLabels } from './i18n/locale.js';
import { createLocaleRegistry } from './i18n/registry.js';
import type { I18nConfig } from './node/i18n-config.js';
import type {
  ApiProp,
  GlobalDefinition,
  Loader,
  PlayFunction,
  ExtensionPanel,
  ExtensionTool,
  Renderer,
  Viewport,
} from './runtime/types.js';
export type * from './runtime/types.js';
export {
  action,
  spy,
  logAction,
  getActions,
  clearActions,
} from './runtime/actions.js';
export { domRenderer } from './renderers.js';
export {
  resolveLocale,
  resolveSiteLocale,
  resolveText,
  createLocaleRegistry,
} from './i18n/registry.js';
export { createTranslator, engineSchema } from './i18n/translator.js';
export type {
  Translator,
  MessageSchema,
  MessageDefinition,
  CatalogResources,
  EngineSchema,
  NamespaceMessages,
} from './i18n/translator.js';
export type { I18nConfig } from './node/i18n-config.js';
export type {
  LocaleRegistry,
  LocaleRegistryInput,
  LocaleDefinition,
  ResolvedText,
} from './i18n/registry.js';
export type { Locale, LocalizedText, NavigationLabels } from './i18n/locale.js';

export type Text = string | LocalizedText;
export type Theme = 'light' | 'dark';
export type ThemePreference = Theme | 'system';
export interface GridOptions {
  step?: number;
  majorEvery?: number;
  opacity?: number;
  offsetX?: number;
  offsetY?: number;
}
export interface SpaceLabConfig {
  name: string;
  version: string;
  content: string[];
  /** Additional public document text for a project-relative, slash-separated file path. */
  documentSearchText?: (
    file: string,
    context?: { locale: Locale; logicalId: string },
  ) => string | undefined;
  preview?: string;
  defaultLocale?: Locale;
  i18n?: I18nConfig;
  defaultTheme?: ThemePreference;
  labels?: NavigationLabels;
  sectionOrder?: string[];
  home?: string;
  base?: string;
  mcp?: boolean;
  grid?: GridOptions;
  globals?: Record<string, unknown>;
  globalTypes?: Record<string, GlobalDefinition>;
  viewports?: Record<string, Viewport>;
  testDirectory?: string;
  vite?: string;
  actions?: { limit?: number; clearOnChange?: boolean };
}
export interface ExampleContext {
  locale: Locale;
  theme: Theme;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Consumer extensions supply dynamically shaped global values.
  globals: Record<string, any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Loader results retain the public dynamic access contract.
  loaded: Record<string, any>;
}
export interface Control {
  type:
    | 'text'
    | 'boolean'
    | 'number'
    | 'range'
    | 'select'
    | 'multi-select'
    | 'radio'
    | 'check'
    | 'date'
    | 'color'
    | 'json'
    | 'file';
  label?: Text;
  description?: Text;
  options?: (string | number)[];
  min?: number;
  max?: number;
  step?: number;
  accept?: string;
  if?: { arg?: string; global?: string; equals?: unknown; truthy?: boolean };
  mapping?: Record<string, unknown>;
}
export interface Example<Props> {
  renderer?: Renderer;
  loaders?: Loader[];
  play?: PlayFunction;
  tags?: string[];
  name?: Text;
  description?: Text;
  args?: Partial<Props>;
  render?: (args: Props, context: ExampleContext) => ReactNode;
  source?: string | ((args: Props) => string);
}
export interface ComponentDocumentation<Props = Record<string, unknown>> {
  title: Text;
  /** Previous page IDs retained after moving or renaming an examples file. */
  aliases?: string[];
  description?: Text;
  component?: ComponentType<Props>;
  componentName?: string;
  args: Props;
  controls?: Partial<Record<keyof Props, Control>>;
  render?: (args: Props, context: ExampleContext) => ReactNode;
  source?: string | ((args: Props) => string);
  examples: Record<string, Example<Props>>;
  loaders?: Loader[];
  play?: PlayFunction;
  api?: ApiProp[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Subcomponents have heterogeneous independently inferred props.
  subcomponents?: Record<string, ComponentType<any>>;
  subcomponentApi?: Record<string, ApiProp[]>;
  excludeControls?: string[];
  renderer?: Renderer;
}
export interface Preview {
  decorators?: ((example: ReactNode, context: ExampleContext) => ReactNode)[];
  loaders?: Loader[];
  panels?: ExtensionPanel[];
  tools?: ExtensionTool[];
}

export function defineConfig<const Config extends SpaceLabConfig>(
  config: Config,
): Config {
  if (
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- JavaScript callers can supply incomplete configuration.
    !config?.name?.trim() ||
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- JavaScript callers can omit version.
    !config.version?.trim() ||
    !Array.isArray(config.content) ||
    (!config.content.length && !config.i18n?.sharedDocuments?.root) ||
    config.content.some((value) => typeof value !== 'string' || !value.trim())
  ) {
    throw new Error(
      'Space Lab: name, version, content are required in space-lab.config.mjs.',
    );
  }
  createLocaleRegistry(config.i18n, config.defaultLocale);
  if (
    config.defaultTheme !== undefined &&
    !['light', 'dark', 'system'].includes(config.defaultTheme)
  ) {
    throw new Error('Space Lab: defaultTheme must be light, dark or system.');
  }
  if (
    config.base !== undefined &&
    (!config.base.startsWith('/') ||
      !config.base.endsWith('/') ||
      /[?#\\]/.test(config.base))
  ) {
    throw new Error(
      'Space Lab: base must be a path starting and ending with /.',
    );
  }
  if (config.grid) {
    for (const [key, value] of Object.entries(config.grid)) {
      if (
        !['step', 'majorEvery', 'opacity', 'offsetX', 'offsetY'].includes(
          key,
        ) ||
        typeof value !== 'number' ||
        !Number.isFinite(value) ||
        (key === 'step' && value < 2) ||
        (key === 'majorEvery' && (!Number.isInteger(value) || value < 2)) ||
        (key === 'opacity' && (value < 0 || value > 1))
      ) {
        throw new Error(`Space Lab: invalid grid.${key}.`);
      }
    }
  }
  if (
    config.testDirectory &&
    (config.testDirectory.startsWith('/') ||
      /^[A-Za-z]:/.test(config.testDirectory) ||
      config.testDirectory.split(/[\\/]/).includes('..'))
  )
    throw new Error('Space Lab: testDirectory must be inside the project.');
  for (const [id, viewport] of Object.entries(config.viewports ?? {})) {
    if (
      ![viewport.width, viewport.height].every(
        (value) => Number.isFinite(value) && value >= 240 && value <= 4000,
      )
    )
      throw new Error(`Space Lab: invalid viewport ${id}.`);
  }
  return config;
}
export function defineExamples<Props>(
  documentation: ComponentDocumentation<Props>,
): ComponentDocumentation<Props> {
  return documentation;
}
