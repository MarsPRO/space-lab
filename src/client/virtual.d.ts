declare module 'virtual:space-lab/site' {
  export const engineVersion: string;
  export const config: import('../index.js').SpaceLabConfig;
  export const entries: import('../node/content.js').ContentEntry[];
  export const development: boolean;
}
declare module 'virtual:space-lab/content' {
  export const loaders: Partial<
    Record<string, (locale?: string) => Promise<{ default: unknown }>>
  >;
  export const preview: import('../index.js').Preview;
}
declare module '*.css';
declare module 'virtual:space-lab/document-catalogs' {
  export const documentCatalogs: Partial<
    Record<
      string,
      Partial<Record<string, () => Promise<Record<string, string>>>>
    >
  >;
}
declare module 'virtual:space-lab/i18n' {
  export const registry: import('../i18n/registry.js').LocaleRegistry;
  export const schema: import('../i18n/translator.js').MessageSchema;
  export const catalogLoaders: Record<
    string,
    () => Promise<{ default: import('../i18n/translator.js').CatalogResources }>
  >;
}
