import js from '@eslint/js'
import globals from 'globals'
import react from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'
import prettier from 'eslint-config-prettier'

export default [
  {
    ignores: ['dist/**', 'node_modules/**', 'public/**', 'data-pipeline-python/**', 'coverage/**'],
  },

  js.configs.recommended,

  // Tarayıcı tarafı: React + hooks kuralları. JSX runtime otomatik (React import'u gerekmez).
  {
    files: ['src/**/*.{js,jsx}'],
    ...react.configs.flat.recommended,
    languageOptions: {
      ...react.configs.flat.recommended.languageOptions,
      globals: { ...globals.browser },
    },
    settings: { react: { version: 'detect' } },
  },
  {
    files: ['src/**/*.{js,jsx}'],
    ...react.configs.flat['jsx-runtime'],
  },
  {
    files: ['src/**/*.{js,jsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs['recommended-latest'].rules,
      // Klasik hook kuralları hata; React Compiler dönemi kuralları uyarı — proje compiler
      // kullanmıyor, bu kurallar ileride geçiş için yol gösterici, engel değil.
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/immutability': 'warn',
      'react-hooks/refs': 'warn',
      'react-hooks/preserve-manual-memoization': 'warn',
      // PropTypes kullanılmıyor (JS projesi, tip bilgisi JSDoc/isimlendirmeyle).
      'react/prop-types': 'off',
      // Türkçe arayüz metinlerinde tırnak doğal; &quot; kaynağın okunabilirliğini bozar.
      'react/no-unescaped-entities': 'off',
    },
  },

  // Sunucu ve araç dosyaları: Node globals.
  {
    files: ['server/**/*.js', 'vite.config.js', 'vitest.globalSetup.js', 'eslint.config.js'],
    languageOptions: { globals: { ...globals.node } },
  },

  // Testler: vitest global'leri kullanmıyor (import ediliyor); yalnızca Node ortamı yeter.
  {
    files: ['**/*.test.{js,jsx}'],
    languageOptions: { globals: { ...globals.node } },
  },

  // Biçimlendirmeyi Prettier yönetir; ESLint'in çakışan stil kuralları kapanır. En sonda olmalı.
  prettier,
]
