import type { Text } from '../index.js';
import type { Locale } from '../i18n/locale.js';
import { resolveText, legacyRegistry } from '../i18n/registry.js';
export function text(
  value: Text | undefined,
  locale: Locale,
  registry = legacyRegistry,
): string {
  return resolveText(value, locale, registry).value;
}
export function readState() {
  return new URLSearchParams(
    typeof location === 'undefined' ? '' : location.hash.slice(1),
  );
}
export function updateState(values: Record<string, string>, replace = false) {
  const state = readState();
  for (const [key, value] of Object.entries(values)) {
    if (value) state.set(key, value);
    else state.delete(key);
  }
  if (replace) {
    history.replaceState(null, '', '#' + state.toString());
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  } else location.hash = state.toString();
}
export function updatePreviewState(
  values: Record<string, string>,
  replace = false,
) {
  if (window.parent === window) updateState(values, replace);
  else
    window.parent.postMessage(
      { type: 'space-lab/state', values, replace },
      location.origin,
    );
}
