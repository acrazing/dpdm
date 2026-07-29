/*!
 * Copyright 2019 acrazing <joking.young@gmail.com>. All rights reserved.
 * @since 2026-07-28 23:00:00
 */

import fs from 'fs-extra';
import { createRequire } from 'module';
import path from 'path';
import ts from 'typescript';
import { pathToFileURL } from 'url';
import type { Config } from './types';

const configNames = [
  'dpdm.config.ts',
  'dpdm.config.mts',
  'dpdm.config.cts',
  'dpdm.config.mjs',
  'dpdm.config.cjs',
  'dpdm.config.js',
  'dpdm.config.json',
];

function unwrapConfig(value: unknown): Config {
  const config =
    value &&
    typeof value === 'object' &&
    'default' in value &&
    (value as { default?: unknown }).default
      ? (value as { default: unknown }).default
      : value;

  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new TypeError('dpdm config should export an object');
  }
  return config as Config;
}

async function loadTsConfigFile(filename: string): Promise<Config> {
  const source = await fs.readFile(filename, 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: filename,
  }).outputText;
  const require = createRequire(filename);
  const dirname = path.dirname(filename);
  const configModule = { exports: {} as unknown };
  const execute = new Function(
    'exports',
    'require',
    'module',
    '__filename',
    '__dirname',
    output,
  ) as (
    exports: unknown,
    require: NodeRequire,
    module: { exports: unknown },
    filename: string,
    dirname: string,
  ) => void;

  execute(configModule.exports, require, configModule, filename, dirname);
  return unwrapConfig(configModule.exports);
}

async function loadJsConfigFile(filename: string): Promise<Config> {
  const config = await import(pathToFileURL(filename).href);
  return unwrapConfig(config);
}

export function defineConfig(config: Config): Config {
  return config;
}

export function findConfigFile(cwd: string): string | undefined {
  for (const name of configNames) {
    const filename = path.join(cwd, name);
    if (fs.existsSync(filename)) {
      return filename;
    }
  }
  return undefined;
}

export async function loadConfig(
  cwd: string,
  configPath?: string,
): Promise<Config> {
  const filename = configPath
    ? path.resolve(cwd, configPath)
    : findConfigFile(cwd);
  if (!filename) {
    return {};
  }

  const ext = path.extname(filename);
  if (ext === '.json') {
    return unwrapConfig(await fs.readJSON(filename));
  }
  if (ext === '.ts' || ext === '.mts' || ext === '.cts') {
    return loadTsConfigFile(filename);
  }
  return loadJsConfigFile(filename);
}
