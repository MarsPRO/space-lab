/**
 * Проверки базовой локализации: нормализация языковых тегов,
 * валидация реестра локалей и цепочек fallback, выбор языка текста.
 * Проверяется перевод через i18next: формы plural, fallback целой группы
 * сообщений и безопасная подстановка параметров.
 * Требует собранный dist/; использует встроенные тестовые каталоги,
 * без файлов собственной документации и браузера. Запуск: npm test.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as api from '../dist/index.js';

const locales = {
  ru: { name: 'Русский', dir: 'ltr', status: 'complete', fallback: [] },
  en: { name: 'English', dir: 'ltr', status: 'complete', fallback: ['ru'] },
  'pt-BR': {
    name: 'Português (Brasil)',
    dir: 'ltr',
    status: 'draft',
    fallback: ['en'],
  },
  'zh-Hant-TW': {
    name: '繁體中文',
    dir: 'ltr',
    status: 'draft',
    fallback: ['ru'],
  },
};
const registryInput = { sourceLocale: 'ru', fallbackLocale: 'ru', locales };

test('registry canonicalizes regional tags and rejects invalid graphs/defaults', () => {
  assert.equal(typeof api.resolveSiteLocale, 'function');
  const registry = api.createLocaleRegistry(registryInput, 'pt-br');
  assert.equal(api.resolveSiteLocale('PT-br', registry), 'pt-BR');
  assert.equal(api.resolveSiteLocale(undefined, registry), 'pt-BR');
  assert.equal(api.resolveSiteLocale('zh-hant-tw', registry), 'zh-Hant-TW');
  assert.throws(() => api.resolveSiteLocale('pt', registry), /locale/i);
  for (const tag of ['pt_BR', 'cimode', '*', 'x-private', 'en-u-nu-arab']) {
    assert.throws(() =>
      api.createLocaleRegistry({
        ...registryInput,
        locales: { ...locales, [tag]: locales.en },
      }),
    );
  }
  assert.throws(() => api.createLocaleRegistry(registryInput, 'de'));
  assert.throws(() =>
    api.createLocaleRegistry({
      ...registryInput,
      locales: { ...locales, 'PT-br': locales['pt-BR'] },
    }),
  );
  assert.throws(() =>
    api.createLocaleRegistry({
      ...registryInput,
      locales: { ...locales, en: { ...locales.en, fallback: ['pt-BR'] } },
    }),
  );
  assert.throws(() =>
    api.createLocaleRegistry({
      ...registryInput,
      locales: { ...locales, en: { ...locales.en, fallback: ['de'] } },
    }),
  );
  assert.equal(api.resolveLocale('de', 'en'), 'en');
  assert.deepEqual(api.resolveText({ ru: 'Название' }, 'pt-BR', registry), {
    value: 'Название',
    requestedLocale: 'pt-BR',
    resolvedLocale: 'ru',
    fallback: true,
  });
});

test('translator uses i18next grammar with atomic locale-family fallback and safe interpolation', async () => {
  assert.equal(typeof api.createTranslator, 'function');
  const registry = api.createLocaleRegistry({
    ...registryInput,
    locales: {
      ...locales,
      ar: { name: 'العربية', dir: 'rtl', status: 'draft', fallback: ['ru'] },
    },
  });
  const schema = {
    examples: {
      greeting: { params: { name: 'string' } },
      items: { params: { count: 'number' }, plural: 'cardinal' },
    },
  };
  const resources = {
    examples: {
      ru: {
        greeting: 'Привет {{name}}',
        items_one: '{{count}} один',
        items_few: '{{count}} несколько',
        items_many: '{{count}} много',
        items_other: '{{count}} дробь',
      },
      en: {
        greeting: 'Hello {{name}}',
        items_one: '{{count}} item',
        items_other: '{{count}} items',
      },
      'pt-BR': { greeting: 'Olá {{name}}', items_one: 'WRONG {{count}}' },
      ar: Object.fromEntries(
        new Intl.PluralRules('ar')
          .resolvedOptions()
          .pluralCategories.map((category) => [
            `items_${category}`,
            `{{count}} ${category}`,
          ]),
      ),
    },
    spaceLab: {
      ru: { copy: 'RU overlay', searchResults_one: 'Один: {{count}}' },
      'pt-BR': { language: 'Idioma' },
    },
  };
  const translator = await api.createTranslator({
    registry,
    resources,
    locale: 'pt-br',
    schema,
  });
  assert.equal(
    translator.t('examples', 'greeting', { name: '<img onerror=x>' }),
    'Olá <img onerror=x>',
  );
  assert.deepEqual(translator.message('examples', 'items', { count: 2 }), {
    value: '2 items',
    requestedLocale: 'pt-BR',
    resolvedLocale: 'en',
    fallback: true,
  });
  assert.equal(translator.t('spaceLab', 'copy'), 'Copy code');
  assert.equal(translator.t('spaceLab', 'language'), 'Idioma');
  const russian = await api.createTranslator({
    registry,
    resources,
    locale: 'ru',
    schema,
  });
  assert.equal(russian.t('spaceLab', 'searchResults', { count: 1 }), 'Один: 1');
  assert.equal(
    russian.t('spaceLab', 'searchResults', { count: 2 }),
    'Найдено 2 документа',
  );
  assert.equal(
    translator.message('spaceLab', 'searchResults', { count: 2 })
      .resolvedLocale,
    'en',
  );
  for (const [count, suffix] of [
    [0, 'много'],
    [1, 'один'],
    [2, 'несколько'],
    [5, 'много'],
    [21, 'один'],
    [1.5, 'дробь'],
  ])
    assert.equal(
      russian.t('examples', 'items', { count }),
      `${count} ${suffix}`,
    );
  const arabic = await api.createTranslator({
    registry,
    resources,
    locale: 'ar',
    schema,
  });
  for (const count of [0, 1, 2, 3, 11, 100, 1.5])
    assert.equal(
      arabic.t('examples', 'items', { count }),
      `${count} ${new Intl.PluralRules('ar').select(count)}`,
    );
  for (const params of [
    {},
    { name: 1 },
    { name: 'x', lng: 'ru' },
    { name: 'x', extra: 1 },
  ])
    assert.throws(() => translator.t('examples', 'greeting', params));
  assert.throws(() => translator.t('examples', 'unknown'));
  for (const patch of [
    { typo: 'x' },
    { greeting: '{{bad}}' },
    { greeting: '{{name, uppercase}}' },
    { greeting: '$t(greeting)' },
    { greeting: null },
    JSON.parse('{"__proto__":"x"}'),
  ]) {
    await assert.rejects(
      api.createTranslator({
        registry,
        locale: 'pt-BR',
        schema,
        resources: {
          ...resources,
          examples: { ...resources.examples, 'pt-BR': patch },
        },
      }),
    );
  }
  await assert.rejects(
    api.createTranslator({
      registry,
      locale: 'ru',
      schema,
      resources: { examples: { ru: {} } },
    }),
  );
  const requestSchema = structuredClone(schema);
  const isolated = await api.createTranslator({
    registry,
    locale: 'ru',
    schema: requestSchema,
    resources,
  });
  requestSchema.examples.greeting.params.name = 'number';
  assert.equal(
    isolated.t('examples', 'greeting', { name: 'request' }),
    'Привет request',
  );
});

export { registryInput };
