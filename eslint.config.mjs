import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['.next/**', 'next-env.d.ts'] },
  { files: ['**/*.ts', '**/*.tsx'], extends: [js.configs.recommended, ...tseslint.configs.recommended] },
  { files: ['**/*.mjs'], ...js.configs.recommended, languageOptions: { globals: { process: 'readonly', URL: 'readonly', fetch: 'readonly', AbortSignal: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly' } } },
);
