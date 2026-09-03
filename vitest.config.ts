import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: { '~': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  /**
   * The same compile-time constants the real build substitutes. Without them a test that
   * imports anything reaching a `__DEV__` guard dies with "__DEV__ is not defined" -- which
   * is how the background's message handlers came to have no tests for a while.
   *
   * `__DEV__` is false here on purpose: tests should exercise the code that ships.
   */
  define: {
    __DEV__: 'false',
    __VERSION__: '"0.0.0-test"',
    __HOST_TAG__: '"chevalet-note-root-test"',
    __FONT_NS__: '"cntest"',
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
