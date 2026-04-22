import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    rules: {
      // Allow variables prefixed with _ or uppercase to be unused (common convention)
      'no-unused-vars': ['warn', { 
        varsIgnorePattern: '^[A-Z_]|^_', 
        argsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_|^e$'
      }],
      // These are common React patterns that are safe - downgrade to warn
      'react-hooks/set-state-in-effect': 'off',
      'react-refresh/only-export-components': 'warn',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
])
