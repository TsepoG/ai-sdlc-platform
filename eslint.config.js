// @ts-check
import js from '@eslint/js';
import vitest from '@vitest/eslint-plugin';
import prettier from 'eslint-config-prettier/flat';
import jsdoc from 'eslint-plugin-jsdoc';
import n from 'eslint-plugin-n';
import sonarjs from 'eslint-plugin-sonarjs';
import { defineConfig, globalIgnores } from 'eslint/config';

/** AI vendor SDKs: only `src/ai-adapters/<vendor>/` may import these (CODING_PRINCIPLES.md §10). */
const AI_VENDOR_SDK_PATTERNS = {
  group: [
    '@anthropic-ai/*',
    'openai',
    'openai/*',
    '@google/genai',
    '@google/genai/*',
    '@aws-sdk/client-bedrock*',
    '@mistralai/*',
    'cohere-ai',
    'cohere-ai/*',
  ],
  message:
    'AI vendor SDKs may only be imported under src/ai-adapters/<vendor>/. Use the src/ai contracts.',
};

const PROCESS_ENV_MESSAGE = 'Read environment variables only in src/config.';

/** `import { env } from 'node:process'` would bypass n/no-process-env, so block it too. */
const PROCESS_ENV_IMPORTS = ['node:process', 'process'].map((name) => ({
  name,
  importNames: ['env'],
  message: PROCESS_ENV_MESSAGE,
}));

export default defineConfig([
  globalIgnores(['node_modules/', 'coverage/', 'infra/cdk.out/']),
  {
    files: ['**/*.js'],
    extends: [
      js.configs.recommended,
      n.configs['flat/recommended-module'],
      jsdoc.configs['flat/recommended-typescript-flavor-error'],
      sonarjs.configs.recommended,
    ],
    linterOptions: { reportUnusedDisableDirectives: 'error' },
    rules: {
      'n/no-process-env': 'error',
      'no-restricted-imports': [
        'error',
        { paths: PROCESS_ENV_IMPORTS, patterns: [AI_VENDOR_SDK_PATTERNS] },
      ],
      'no-restricted-syntax': [
        'error',
        { selector: 'ExportDefaultDeclaration', message: 'Use named exports.' },
        {
          selector: 'ConditionalExpression > ConditionalExpression',
          message: 'No nested ternaries.',
        },
      ],
      'jsdoc/require-jsdoc': [
        'error',
        {
          publicOnly: true,
          require: {
            FunctionDeclaration: true,
            ClassDeclaration: true,
            MethodDefinition: true,
            ArrowFunctionExpression: true,
            FunctionExpression: true,
          },
          contexts: ['ExportNamedDeclaration > VariableDeclaration'],
        },
      ],
      'jsdoc/require-throws': 'error',
      'jsdoc/require-returns': ['error', { publicOnly: true }],
      'jsdoc/no-undefined-types': 'off', // tsc checks JSDoc types with full type information.
      'prefer-const': 'error',
      eqeqeq: ['error', 'always'],
    },
  },
  {
    files: ['src/config/**/*.js'],
    rules: {
      'n/no-process-env': 'off',
      'no-restricted-imports': ['error', { patterns: [AI_VENDOR_SDK_PATTERNS] }],
    },
  },
  {
    files: ['src/ai-adapters/**/*.js'],
    rules: {
      'no-restricted-imports': ['error', { paths: PROCESS_ENV_IMPORTS }],
    },
  },
  {
    files: ['src/**/*.js'],
    rules: { 'no-console': 'error' },
  },
  {
    files: ['test/**/*.js'],
    extends: [vitest.configs.recommended],
  },
  {
    // Tool configs must default-export their configuration.
    files: ['eslint.config.js', 'vitest.config.js'],
    rules: { 'no-restricted-syntax': 'off' },
  },
  prettier,
]);
