import js from '@eslint/js';
import ts from 'typescript-eslint';
export default ts.config(
  { ignores: ['**/dist/**', '.cache/**', 'test/fixtures/**', 'node_modules/**'] },
  js.configs.recommended,
  ...ts.configs.recommended,
  { languageOptions: { globals: { process: 'readonly', console: 'readonly', URL: 'readonly' } },
    rules: { '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }], 'no-empty': ['error', { allowEmptyCatch: true }] } },
);
