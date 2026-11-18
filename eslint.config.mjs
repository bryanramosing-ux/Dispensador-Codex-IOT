import eslint from '@eslint/js';
import vue from 'eslint-plugin-vue';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default [
  { ignores: ['**/dist/**', '**/coverage/**'] },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  ...vue.configs['flat/essential'],
  { files: ['**/*.vue'], languageOptions: { parserOptions: { parser: tseslint.parser } } },
  { files: ['apps/backend/**/*.{ts,cjs}'], languageOptions: { globals: {...globals.node, ...globals.jest} } },
  { files: ['apps/frontend/**/*.{ts,vue}'], languageOptions: { globals: globals.browser } },
];
