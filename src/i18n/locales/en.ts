import en from './en.json' with { type: 'json' };
import type EnglishCatalog from './en.json';
export type MessageCatalog = typeof EnglishCatalog;
const catalog: MessageCatalog = en;
export default catalog;
