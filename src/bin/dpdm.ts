#!/usr/bin/env node
/*!
 * Copyright 2019 acrazing <joking.young@gmail.com>. All rights reserved.
 * @since 2019-07-17 18:45:32
 */

import chalk from 'chalk';
import fs from 'fs-extra';
import ora from 'ora';
import path from 'path';
import yargs from 'yargs';
import { parseDependencyTree } from '../parser';
import { ParseOptions } from '../types';
import {
  defaultOptions,
  glob,
  parseCircular,
  parseWarnings,
  prettyCircular,
  prettyTree,
  prettyWarning,
  simpleResolver,
} from '../utils';

const argv = yargs
  .strict()
  .usage('$0 [options] files...')
  .option('context', {
    type: 'string',
    desc: 'the context directory to shorten path, default is current directory',
  })
  .option('extensions', {
    alias: 'ext',
    type: 'string',
    desc: 'comma separated extensions to resolve',
    default: defaultOptions.extensions.filter(Boolean).join(','),
  })
  .option('js', {
    type: 'string',
    desc: 'comma separated extensions indicate the file is js like',
    default: defaultOptions.js.join(','),
  })
  .option('include', {
    type: 'string',
    desc: 'included filenames regexp in string, default includes all files',
    default: defaultOptions.include.source,
  })
  .option('exclude', {
    type: 'string',
    desc:
      'excluded filenames regexp in string, set as empty string to include all files',
    default: defaultOptions.exclude.source,
  })
  .option('output', {
    alias: 'o',
    type: 'string',
    desc: 'output json to file',
  })
  .option('tree', {
    type: 'boolean',
    desc: 'print tree to stdout',
    default: true,
  })
  .option('circular', {
    type: 'boolean',
    desc: 'print circular to stdout',
    default: true,
  })
  .option('warning', {
    type: 'boolean',
    desc: 'print warning to stdout',
    default: true,
  })
  .option('tsconfig', {
    type: 'string',
    desc:
      'the tsconfig path, which is used for resolve path alias, default is tsconfig.json if it exists in context directory',
  })
  .option('transform', {
    type: 'boolean',
    desc:
      'transform typescript modules to javascript before analyze, it allows you to omit types dependency in typescript',
    default: defaultOptions.transform,
    alias: 'T',
  })
  .option('exit-code', {
    type: 'string',
    desc:
      'exit with specified code, the value format is CASE:CODE, `circular` is the only supported CASE, ' +
      'CODE should be a integer between 0 and 128. ' +
      'For example: `dpdm --exit-code circular:1` the program will exit with code 1 if circular dependency found.',
  })
  .alias('h', 'help')
  .wrap(Math.min(yargs.terminalWidth(), 100)).argv;

if (argv._.length === 0) {
  yargs.showHelp();
  console.log('\nMissing entry file');
  process.exit(1);
}

const exitCases = new Set(['circular']);
const exitCodes: [string, number][] = [];
if (argv['exit-code']) {
  argv['exit-code'].split(',').forEach((c) => {
    const [label, code] = c.split(':');
    if (!code || !isFinite(+code)) {
      throw new TypeError(`exit code should be a number`);
    }
    if (!exitCases.has(label)) {
      throw new TypeError(`unsupported exit case "${label}"`);
    }
    exitCodes.push([label, +code]);
  });
}

const o = ora('Loading dependencies...').start();

let total = 0;
let ended = 0;
let current = '';

const context = argv.context || process.cwd();

function onProgress(event: 'start' | 'end', target: string) {
  switch (event) {
    case 'start':
      total += 1;
      current = path.relative(context, target);
      break;
    case 'end':
      ended += 1;
      break;
  }
  o.text = `[${ended}/${total}] Analyzing ${current}...`;
  o.render();
}

const options: ParseOptions = {
  context,
  extensions: argv.extensions.split(','),
  js: argv.js.split(','),
  include: new RegExp(argv.include || '.*'),
  exclude: new RegExp(argv.exclude || '$.'),
  tsconfig: argv.tsconfig,
  transform: argv.transform,
  onProgress,
};

parseDependencyTree(argv._, options)
  .then(async (tree) => {
    o.succeed(`[${ended}/${total}] Analyze done!`);
    const entriesDeep = await Promise.all(argv._.map((g) => glob(g)));
    const entries = await Promise.all(
      Array<string>()
        .concat(...entriesDeep)
        .map((name) =>
          simpleResolver(
            options.context!,
            path.join(options.context!, name),
            options.extensions,
          ).then((id) => (id ? path.relative(options.context!, id) : name)),
        ),
    );
    const circulars = parseCircular(tree);
    if (argv.output) {
      await fs.outputJSON(
        argv.output,
        { entries, tree, circulars },
        { spaces: 2 },
      );
    }
    if (argv.tree) {
      console.log(chalk.bold('• Dependencies Tree'));
      console.log(prettyTree(tree, entries));
      console.log('');
    }
    if (argv.circular) {
      console.log(chalk.bold.red('• Circular Dependencies'));
      if (circulars.length === 0) {
        console.log(
          chalk.bold.green(
            '  ✅ Congratulations, no circular dependency were found in your project.',
          ),
        );
      } else {
        console.log(prettyCircular(circulars));
      }
      console.log('');
    }
    if (argv.warning) {
      console.log(chalk.bold.yellow('• Warnings'));
      console.log(prettyWarning(parseWarnings(tree)));
      console.log('');
    }
    for (const [label, code] of exitCodes) {
      switch (label) {
        case 'circular':
          if (circulars.length > 0) {
            process.exit(code);
          }
      }
    }
  })
  .catch((e: Error) => {
    o.fail();
    console.error(e.stack || e);
    process.exit(1);
  });
