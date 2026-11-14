/*
 * @since 2026-01-30 16:44:23
 * @author acrazing <joking.young@gmail.com>
 */

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['src/**/*.spec.ts'],
  },
});
