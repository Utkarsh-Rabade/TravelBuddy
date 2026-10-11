import nextWebVitals from 'eslint-config-next/core-web-vitals';

export default [
  ...nextWebVitals,
  {
    ignores: ['.next/**', 'node_modules/**', 'playwright-report/**'],
  },
];
