/*!
 * Copyright 2019 acrazing <joking.young@gmail.com>. All rights reserved.
 * @since 2026-07-28 23:00:00
 */

import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { findConfigFile, loadConfig } from './config.js';

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

  it.each(['ts', 'mts', 'cts'])(
    'loads a .%s config with an import relative to the config file',
    async (extension) => {
      const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'dpdm-config-'));
      const filename = path.join(cwd, `dpdm.config.${extension}`);
      try {
        await fs.writeFile(
          filename,
          [
            "import file from './entry.cjs';",
            'const files: string[] = [file];',
            `export default { files, tree: __filename.endsWith('.${extension}') };`,
          ].join('\n'),
        );
        await fs.writeFile(
          path.join(cwd, 'entry.cjs'),
          "module.exports = 'entry.ts';",
        );

        await expect(loadConfig(cwd)).resolves.toEqual({
          files: ['entry.ts'],
          tree: true,
        });
      } finally {
        await fs.remove(cwd);
      }
    },
  );
});
