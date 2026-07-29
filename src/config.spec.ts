/*!
 * Copyright 2019 acrazing <joking.young@gmail.com>. All rights reserved.
 * @since 2026-07-28 23:00:00
 */

import path from 'path';
import { findConfigFile, loadConfig } from './config';

describe('config', () => {
  const fixture = path.join(__dirname, '../fixtures/config');

  it('should find and load TypeScript config files', async () => {
    expect(findConfigFile(fixture)).toBe(path.join(fixture, 'dpdm.config.ts'));
    await expect(loadConfig(fixture)).resolves.toEqual({
      files: ['src/index.ts'],
      tree: false,
      circular: true,
      warning: false,
      ignoreMissWarning: ['^vscode$'],
    });
  });
});
