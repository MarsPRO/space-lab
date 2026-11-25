import { I18nError } from './registry.js';

export interface I18nDiagnostic {
  severity: 'error' | 'incomplete' | 'warning';
  code: string;
  locale?: string;
  namespace?: string;
  file?: string;
  key?: string;
  line?: number;
  column?: number;
  target?: string;
  missing?: string[];
}

/** Never serialize parser messages, authored source, stacks or arbitrary config values. */
export function diagnosticFromError(
  error: unknown,
  fallback: string,
): I18nDiagnostic {
  return {
    severity: 'error',
    code: error instanceof I18nError ? error.code : fallback,
    ...(error instanceof I18nError
      ? Object.fromEntries(
          Object.entries(error.params).filter(([key]) =>
            ['locale', 'namespace', 'file', 'key'].includes(key),
          ),
        )
      : {}),
    ...(error instanceof I18nError && error.params.path
      ? { file: error.params.path }
      : {}),
  };
}
