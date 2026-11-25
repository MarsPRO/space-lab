const aliases: Record<string, string> = {
  js: 'javascript',
  javascript: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'jsx',
  ts: 'typescript',
  typescript: 'typescript',
  tsx: 'tsx',
  json: 'json',
  sh: 'bash',
  shell: 'bash',
  bash: 'bash',
  html: 'markup',
  xml: 'markup',
  svg: 'markup',
  markup: 'markup',
  css: 'css',
  md: 'markdown',
  mdx: 'markdown',
  markdown: 'markdown',
  yml: 'yaml',
  yaml: 'yaml',
  php: 'php',
};

export function codeLanguage(value: string) {
  const name = value.trim().toLowerCase();
  return Object.hasOwn(aliases, name) ? aliases[name] : 'plain';
}
