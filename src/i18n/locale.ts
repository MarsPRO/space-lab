export type { Locale, LocalizedText, NavigationLabels } from './registry.js';
import type { Locale, NavigationLabels } from './registry.js';
import { resolveText, legacyRegistry } from './registry.js';
import type { LocaleRegistry } from './registry.js';
export { resolveLocale } from './registry.js';

export const messages = { ru, en };

export function translateLabel(
  name: string,
  id: string,
  locale: Locale,
  labels: NavigationLabels = {},
  registry: LocaleRegistry = legacyRegistry,
  catalog: Pick<
    typeof en,
    'guide' | 'components' | 'changes' | 'documentation'
  > = locale === 'ru' ? ru : en,
): string {
  const translations: Partial<NavigationLabels> = labels;
  const custom = translations[id] ?? translations[name];
  if (custom) return resolveText(custom, locale, registry).value || name;
  const text = catalog;
  const defaults: Record<string, string> = {
    [en.guide]: text.guide,
    [ru.guide]: text.guide,
    [en.components]: text.components,
    [ru.components]: text.components,
    [en.changes]: text.changes,
    [ru.changes]: text.changes,
    [en.documentation]: text.documentation,
    [ru.documentation]: text.documentation,
  };
  return defaults[name] ?? name;
}
import ru from './locales/ru.js';
import en from './locales/en.js';
