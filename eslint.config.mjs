import js from '@eslint/js';
import comments from '@eslint-community/eslint-plugin-eslint-comments';
import { defineConfig, globalIgnores } from 'eslint/config';
import prettier from 'eslint-config-prettier/flat';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const typedFiles = ['src/**/*.{ts,tsx}'];
const toolingFiles = [
  'scripts/build.mjs',
  'scripts/check-support.mjs',
  'eslint.config.mjs',
  'prettier.config.mjs',
];
const javascriptFiles = ['src/**/*.{js,jsx,mjs,cjs}', ...toolingFiles];

const naming = [
  { selector: 'variable', format: ['camelCase'] },
  {
    selector: 'variable',
    modifiers: ['const', 'global'],
    format: ['camelCase', 'UPPER_CASE'],
  },
  { selector: 'function', format: ['camelCase'] },
  { selector: 'parameter', format: ['camelCase'], leadingUnderscore: 'allow' },
  { selector: 'method', format: ['camelCase'] },
  { selector: 'typeLike', format: ['PascalCase'] },
  // Imported bindings preserve external APIs; object/data keys are not renamed.
  { selector: 'import', format: null },
];

export default defineConfig(
  globalIgnores([
    '**/*',
    '!src/',
    '!src/**',
    '!scripts/',
    ...toolingFiles.map((file) => '!' + file),
    '**/node_modules/**',
    '**/dist/**',
    '**/.cache/**',
    '**/.space-lab/**',
    '**/__generated__/**',
    '**/*.generated.*',
  ]),
  {
    files: [...typedFiles, ...javascriptFiles],
    plugins: { '@eslint-community/eslint-comments': comments },
    linterOptions: { reportUnusedDisableDirectives: 'error' },
    rules: {
      '@eslint-community/eslint-comments/no-unlimited-disable': 'error',
      '@eslint-community/eslint-comments/require-description': 'error',
      '@eslint-community/eslint-comments/no-use': [
        'error',
        { allow: ['eslint-disable-next-line'] },
      ],
    },
  },
  {
    files: typedFiles,
    extends: [
      js.configs.recommended,
      tseslint.configs.strictTypeChecked,
      tseslint.configs.stylisticTypeChecked,
    ],
    languageOptions: {
      parserOptions: {
        project: './tsconfig.quality.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/naming-convention': ['error', ...naming],
    },
  },
  {
    files: ['src/**/*.tsx'],
    rules: {
      '@typescript-eslint/naming-convention': [
        'error',
        ...naming.filter((rule) => rule.selector !== 'function'),
        // React function components and callable component bindings in TSX only.
        { selector: 'function', format: ['camelCase', 'PascalCase'] },
        {
          selector: 'variable',
          types: ['function'],
          format: ['camelCase', 'PascalCase'],
        },
      ],
    },
  },
  {
    files: javascriptFiles,
    extends: [js.configs.recommended],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        project: false,
        projectService: false,
        ecmaFeatures: { jsx: true },
      },
      globals: { ...globals.node, ...globals.browser },
    },
    plugins: { '@typescript-eslint': tseslint.plugin },
    rules: {
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': 'error',
    },
  },
  {
    files: ['scripts/**/*.mjs', '*.{js,mjs,cjs}'],
    languageOptions: {
      globals: {
        ...globals.node,
        ...Object.fromEntries(
          Object.keys(globals.browser)
            .filter((key) => !(key in globals.node))
            .map((key) => [key, 'off']),
        ),
      },
    },
  },
  // Must remain last: formatting belongs to the standalone Prettier command.
  prettier,
);
