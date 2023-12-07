/*!
 * Copyright 2019 acrazing <joking.young@gmail.com>. All rights reserved.
 * @since 2019-07-17 18:45:47
 */

import fs from 'fs-extra';
import { dirname, join } from 'path';
import { parseCircular, simpleResolver } from './utils';
import type { Dependency } from './types';
import { DependencyKind } from './consts';

describe('util', () => {
  it('should resolve correctly', async () => {
    const ext = ['', '.js', '.jsx', '.ts', '.tsx', '.json'];
    const local = await simpleResolver(__dirname, './bin/dpdm', ext);
    const index = await simpleResolver(__dirname, '.', ext);

    await fs.outputJSON('node_modules/dpdm-ut-parent/package.json', {
      name: 'dpdm-ut-parent',
      version: '1.0.0',
      main: 'index.js',
      dependencies: {
        'dpdm-ut-deep': '^1.0.0',
      },
    });
    await fs.outputFile('node_modules/dpdm-ut-parent/index.js', '');

    await fs.outputJSON(
      'node_modules/dpdm-ut-parent/node_modules/dpdm-ut-deep/package.json',
      {
        name: 'dpdm-ut-deep',
        version: '1.0.0',
        main: 'index.js',
      },
    );
    await fs.outputFile(
      'node_modules/dpdm-ut-parent/node_modules/dpdm-ut-deep/index.js',
      '',
    );

    await fs.outputJSON('node_modules/dpdm-ut-deep/package.json', {
      name: 'dpdm-ut-deep',
      version: '2.0.0',
      main: 'index.js',
    });
    await fs.outputFile('node_modules/dpdm-ut-deep/index.js', '');

    const pkg = await simpleResolver(__dirname, 'dpdm-ut-parent', ext);
    const deepPkg = await simpleResolver(dirname(pkg!), 'dpdm-ut-deep', ext);
    const notFound = await simpleResolver(__dirname, './utils.tsx', ext);
    expect([local, index, pkg, deepPkg, notFound]).toEqual([
      join(__dirname, 'bin/dpdm.ts'),
      join(__dirname, 'index.ts'),
      join(__dirname, '../node_modules/dpdm-ut-parent/index.js'),
      join(
        __dirname,
        '../node_modules/dpdm-ut-parent/node_modules/dpdm-ut-deep/index.js',
      ),
      null,
    ]);
  });

  describe('When parsing circular', () => {
    function dependencyFactory(id: string): Dependency {
      return {
        issuer: '',
        request: '',
        kind: DependencyKind.StaticImport,
        id,
      };
    }

    describe('When tree is empty', () => {
      const tree = {};
      it('Should return empty array', () => {
        const actual = parseCircular(tree);
        expect(actual.length).toBe(0);
      });
    });

    describe('When tree has just a root with no dependencies', () => {
      const tree = { a: [] };
      it('Should return empty array', () => {
        const actual = parseCircular(tree);
        expect(actual.length).toBe(0);
      });
    });

    describe('When tree has 2 nodes, no cycle', () => {
      const tree = { a: [dependencyFactory('b')], b: [] };
      it('Should return empty array', () => {
        const actual = parseCircular(tree);
        expect(actual.length).toBe(0);
      });
    });

    describe('When tree has 2 nodes, with cycle', () => {
      const id1 = 'a';
      const id2 = 'b';
      const tree = {
        [id1]: [dependencyFactory(id2)],
        [id2]: [dependencyFactory(id1)],
      };

      let actual: Array<string[]>;
      beforeAll(() => {
        actual = parseCircular(tree);
      });

      it('Should return non-empty array', () => {
        expect(actual.length).toBeGreaterThan(0);
      });

      it('Should count only one cycle', () => {
        expect(actual.length).toBe(1);
      });

      it('Should include the ids involved in the cycle', () => {
        expect(actual[0]).toMatchObject([id1, id2]);
      });
    });

    describe('When tree has a deep cycle', () => {
      const ids = ['a', 'b', 'c'];
      const tree = {
        [ids[0]]: [dependencyFactory(ids[1])],
        [ids[1]]: [dependencyFactory(ids[2])],
        [ids[2]]: [dependencyFactory(ids[0])],
      };

      let actual: Array<string[]>;
      beforeAll(() => {
        actual = parseCircular(tree);
      });

      it('Should return non-empty array', () => {
        expect(actual.length).toBeGreaterThan(0);
      });

      it('Should count only one cycle', () => {
        expect(actual.length).toBe(1);
      });

      it('Should include the ids involved in the cycle', () => {
        expect(actual[0]).toMatchObject(ids);
      });
    });

    describe('When tree has 2 cycles with no intersection', () => {
      const tree = {
        left1: [dependencyFactory('left2')],
        left2: [dependencyFactory('left1')],
        right1: [dependencyFactory('right2')],
        right2: [dependencyFactory('right1')],
      };

      let actual: Array<string[]>;
      beforeAll(() => {
        actual = parseCircular(tree);
      });

      it('Should return non-empty array', () => {
        expect(actual.length).toBeGreaterThan(0);
      });

      it('Should count two cycles', () => {
        expect(actual.length).toBe(2);
      });

      it('Should include the ids involved in the cycle', () => {
        expect(actual[0]).toMatchObject(['left1', 'left2']);
        expect(actual[1]).toMatchObject(['right1', 'right2']);
      });
    });

    describe('When tree has 2 cycles from common node', () => {
      const tree = {
        start: [dependencyFactory('left'), dependencyFactory('right')],
        left: [dependencyFactory('start')],
        right: [dependencyFactory('start')],
      };

      let actual: Array<string[]>;
      beforeAll(() => {
        actual = parseCircular(tree);
      });

      it('Should return non-empty array', () => {
        expect(actual.length).toBeGreaterThan(0);
      });

      it('Should count two cycles', () => {
        expect(actual.length).toBe(2);
      });

      it('Should include the ids involved in the cycle', () => {
        expect(actual[0]).toMatchObject(['start', 'left']);
        expect(actual[1]).toMatchObject(['start', 'right']);
      });
    });

    describe('When tree has 2 cycles with multi-node intersection', () => {
      const tree = {
        start: [dependencyFactory('mid')],
        mid: [dependencyFactory('left'), dependencyFactory('right')],
        left: [dependencyFactory('start')],
        right: [dependencyFactory('start')],
      };

      let actual: Array<string[]>;
      beforeAll(() => {
        actual = parseCircular(tree);
      });

      it('Should return non-empty array', () => {
        expect(actual.length).toBeGreaterThan(0);
      });

      it('Should count two cycles', () => {
        expect(actual.length).toBe(2);
      });

      it('Should include the ids involved in the cycle', () => {
        expect(actual[0]).toMatchObject(['start', 'mid', 'left']);
        expect(actual[1]).toMatchObject(['start', 'mid', 'right']);
      });
    });
  });
});
