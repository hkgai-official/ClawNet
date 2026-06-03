import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import noHardcodedColor from './eslint-rules/no-hardcoded-color.cjs';

const clawnetPlugin = {
  rules: { 'no-hardcoded-color': noHardcodedColor },
};

export default [
  {
    ignores: [
      'node_modules/**',
      'out/**',
      'build/**',
      'dist/**',
      'coverage/**',
      'resources/**',
      'pnpm-lock.yaml',
      // Ad-hoc playwright-driven diagnostic smokes. Mixed Node + browser
      // contexts (page.evaluate inlines DOM calls). Skipping lint here
      // keeps the scripts terse without per-call eslint-disable noise.
      'scripts/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { varsIgnorePattern: '^_', argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node },
    },
  },
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    plugins: {
      react,
      'react-hooks': reactHooks,
      clawnet: clawnetPlugin,
    },
    languageOptions: {
      globals: { ...globals.browser },
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    rules: {
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'clawnet/no-hardcoded-color': 'error',
    },
    settings: { react: { version: '18.3' } },
  },
  {
    files: ['**/*.test.ts', '**/*.test.tsx'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
];
