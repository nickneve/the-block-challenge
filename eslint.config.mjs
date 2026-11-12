// @ts-check
import eslint from '@eslint/js';
import angular from 'angular-eslint';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/.angular/**',
      '**/coverage/**',
      'playwright-report/**',
      'test-results/**',
      // Provided with the challenge (generates data/vehicles.json); left as it came.
      'scripts/generate_vehicles.mjs',
    ],
  },

  // TypeScript everywhere.
  {
    files: ['**/*.ts'],
    extends: [eslint.configs.recommended, tseslint.configs.recommended],
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports', disallowTypeAnnotations: false }],
    },
  },

  // The API and its tests run on Node.
  {
    files: ['apps/api/**/*.ts', 'e2e/**/*.ts', 'playwright.config.ts'],
    languageOptions: { globals: globals.node },
  },
  // Nest resolves constructor dependencies from their runtime classes, so injected types must be real imports.
  {
    files: ['apps/api/src/**/*.ts'],
    rules: { '@typescript-eslint/consistent-type-imports': 'off' },
  },

  // The web app: Angular's component and template rules.
  {
    files: ['apps/web/src/**/*.ts'],
    extends: [angular.configs.tsRecommended],
    processor: angular.processInlineTemplates,
    languageOptions: { globals: globals.browser },
    rules: {
      // Angular's DI and signal inputs need runtime imports too.
      '@typescript-eslint/consistent-type-imports': 'off',
      '@angular-eslint/component-selector': ['error', { type: ['element', 'attribute'], prefix: 'app', style: 'kebab-case' }],
      '@angular-eslint/directive-selector': ['error', { type: 'attribute', prefix: 'app', style: 'camelCase' }],
    },
  },
  {
    files: ['apps/web/src/**/*.html'],
    extends: [angular.configs.templateRecommended, angular.configs.templateAccessibility],
  },

  // Build and maintenance scripts.
  {
    files: ['**/*.{js,mjs,cjs}'],
    extends: [eslint.configs.recommended],
    languageOptions: { globals: globals.node },
  },
);
