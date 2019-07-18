#!/usr/bin/env node
/*!
 * Copyright 2019 acrazing <joking.young@gmail.com>. All rights reserved.
 * @since 2019-07-17 18:45:32
 */

import chalk from 'chalk';
import fs from 'fs-extra';
import path from 'path';
import yargs from 'yargs';
import { parseDependencyTree } from '../parser';
import { ParseOptions } from '../types';
import {
  glob,
  parseCircular,
  parseWarnings,
  prettyCircular,
  prettyTree,
  prettyWarning,
  resolve,
} from '../utils';

const argv = yargs
  .usage('$0 [<options>] entry...')
  .option('context', {
    type: 'string',
    desc: 'the context directory to shorten path, default is process.cwd()',
  })
  .option('extensions', {
    alias: 'ext',
    type: 'string',
    desc: 'comma separated extensions to resolve',
    default: '.ts,.tsx,.mjs,.js,.jsx,.json',
  })
  .option('include', {
    type: 'string',
    desc: 'included filenames regexp in string',
    default: '\\.[tj]sx?$',
  })
  .option('exclude', {
    type: 'string',
    desc: 'excluded filenames regexp in string',
    default: '/node_modules/',
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
  .alias('h', 'help')
  .wrap(Math.min(yargs.terminalWidth(), 120)).argv;

if (argv._.length === 0) {
  yargs.showHelp();
  console.log('\nMissing entry file');
  process.exit(1);
}

const RE_NONE = /$./;

const options: ParseOptions = {
  context: argv.context || process.cwd(),
  extensions: argv.extensions.split(','),
  include: new RegExp(argv.include),
  exclude: argv.exclude ? new RegExp(argv.exclude) : RE_NONE,
};

parseDependencyTree(argv._, options)
  .then(async (tree) => {
    const entriesDeep = await Promise.all(argv._.map((g) => glob(g)));
    const entries = await Promise.all(
      entriesDeep
        .flat()
        .map((name) =>
          resolve(options.context!, name, options.extensions).then((id) =>
            id ? path.relative(options.context!, id) : name,
          ),
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
      console.log(chalk.bold.whiteBright('• Dependencies Tree'));
      console.log(prettyTree(tree, entries));
      console.log('');
    }
    if (argv.circular) {
      console.log(chalk.bold.redBright('• Circular Dependencies'));
      console.log(prettyCircular(circulars));
      console.log('');
    }
    if (argv.warning) {
      console.log(chalk.bold.yellowBright('• Warnings'));
      console.log(prettyWarning(parseWarnings(tree)));
      console.log('');
    }
  })
  .catch((e) => {
    console.error(e);
    process.exit(e);
  });
