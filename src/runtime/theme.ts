import type { Theme, ThemePreference } from '../index.js';

export function themePreference(
  value: unknown,
  fallback: ThemePreference = 'system',
): ThemePreference {
  return value === 'light' || value === 'dark' || value === 'system'
    ? value
    : fallback;
}

export function resolveTheme(
  override: string | null,
  preference: ThemePreference,
  system: Theme,
): Theme {
  if (override === 'light' || override === 'dark') return override;
  return preference === 'system' ? system : preference;
}

export function themeStorageKey(pathname: string) {
  return (
    'space-lab:theme-preference:' +
    pathname.replace(/(?:index|preview)\.html$/, '')
  );
}
