import { defineConfig, transformWithOxc } from 'vite';
import react from '@vitejs/plugin-react';

// The app's source files use the .js extension but contain JSX (the Next.js
// convention). Vite only parses JSX in .jsx/.tsx files, so for tests we compile
// files under app/ as JSX without renaming them.
const jsxInJsFiles = {
  name: 'treat-app-js-as-jsx',
  enforce: 'pre',
  async transform(code, id) {
    const path = id.split('?')[0];
    if (!/[\\/]app[\\/].*\.js$/.test(path) || path.includes('node_modules')) {
      return null;
    }
    return transformWithOxc(code, path.replace(/\.js$/, '.jsx'), {
      jsx: { runtime: 'automatic' },
    });
  },
};

export default defineConfig({
  plugins: [jsxInJsFiles, react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.js'],
    include: ['tests/unit/**/*.test.{js,jsx}'],
    globals: true,
  },
});
