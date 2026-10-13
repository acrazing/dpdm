/*!
 * Copyright 2019 acrazing <joking.young@gmail.com>. All rights reserved.
 * @since 2019-07-17 18:45:47
 */

import fs from 'fs-extra';
import { dirname, join } from 'path';
import {
  matchSubpathImport,
  parseCircular,
  parseWarnings,
  simpleResolver,
} from './utils';
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

  it('should match package.json subpath imports', () => {
    const imports = {
      '#config': { types: './config.d.ts', node: './config.js' },
      '#fallback': [{ browser: './browser.js' }, './fallback.js'],
      '#lib/*': './lib/*',
      '#lib/dir/*': './lib/dir/*.js',
      '#ext/*.css': './styles/*.css',
      '#external': 'some-package',
    };

    expect(matchSubpathImport(imports, '#config')).toBe('./config.js');
    expect(matchSubpathImport(imports, '#fallback')).toBe('./fallback.js');
    expect(matchSubpathImport(imports, '#lib/a/b')).toBe('./lib/a/b');
    expect(matchSubpathImport(imports, '#lib/dir/c')).toBe('./lib/dir/c.js');
    expect(matchSubpathImport(imports, '#ext/main.css')).toBe(
      './styles/main.css',
    );
    expect(matchSubpathImport(imports, '#external')).toBe('some-package');
    expect(matchSubpathImport(imports, '#lib/')).toBeNull();
    expect(matchSubpathImport(imports, '#missing')).toBeNull();
  });

  describe('When parsing circular', () => {
    function dependencyFactory(
      id: string,
      issuer: string = '',
      kind = DependencyKind.StaticImport,
    ): Dependency {
      return {
        issuer,
        request: '',
        kind,
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

    describe('When skip imports are specified', () => {
      it('Should not skip imports when the skip list is empty', () => {
        const tree = {
          a: [dependencyFactory('b', 'a')],
          b: [dependencyFactory('a', 'b')],
        };

        expect(parseCircular(tree, false, [])).toEqual([['a', 'b']]);
      });

      it('Should ignore a matching import edge when parsing circulars', () => {
        const tree = {
          a: [dependencyFactory('b', 'a')],
          b: [dependencyFactory('a', 'b')],
        };

        expect(parseCircular(tree, false, [['b', 'a']])).toEqual([]);
      });

      it('Should only ignore the specified import edge', () => {
        const tree = {
          start: [
            dependencyFactory('left', 'start'),
            dependencyFactory('right', 'start'),
          ],
          left: [dependencyFactory('start', 'left')],
          right: [dependencyFactory('start', 'right')],
        };

        const actual = parseCircular(tree, false, [['left', 'start']]);
        expect(actual).toHaveLength(1);
        expect(actual[0]).toMatchObject(['start', 'right']);
      });

      it('Should support regexp patterns for skipped imports', () => {
        const tree = {
          'src/a.js': [
            dependencyFactory('src/b.js', 'src/a.js'),
            dependencyFactory('src/c.js', 'src/a.js'),
          ],
          'src/b.js': [dependencyFactory('src/a.js', 'src/b.js')],
          'src/c.js': [dependencyFactory('src/a.js', 'src/c.js')],
        };

        expect(parseCircular(tree, false, [['src/a.js', '.*']])).toEqual([]);
      });

      it('Should not match skipped imports by prefix', () => {
        const tree = {
          a: [dependencyFactory('bc', 'a')],
          bc: [dependencyFactory('a', 'bc')],
        };

        expect(parseCircular(tree, false, [['a', 'b']])).toEqual([['a', 'bc']]);
      });
    });
  });

  describe('When parsing warnings', () => {
    it('Should ignore miss warnings matching import request patterns', () => {
      const tree = {
        'src/index.ts': [
          {
            issuer: 'src/index.ts',
            request: 'vscode',
            kind: DependencyKind.StaticImport,
            id: null,
          },
          {
            issuer: 'src/index.ts',
            request: 'missing-runtime',
            kind: DependencyKind.StaticImport,
            id: null,
          },
        ],
      };

      expect(
        parseWarnings(tree, undefined, {
          ignoreMissWarnings: [/^vscode$/],
        }),
      ).toEqual(['miss "missing-runtime" in "src/index.ts"']);
    });

    it('Should ignore skip warnings matching skipped file patterns', () => {
      const tree = {
        'src/index.ts': [
          {
            issuer: 'src/index.ts',
            request: 'pkg',
            kind: DependencyKind.StaticImport,
            id: 'node_modules/pkg/index.js',
          },
          {
            issuer: 'src/index.ts',
            request: './ignored',
            kind: DependencyKind.StaticImport,
            id: 'src/ignored.ts',
          },
        ],
        'node_modules/pkg/index.js': null,
        'src/ignored.ts': null,
      };

      expect(
        parseWarnings(tree, undefined, {
          ignoreSkipWarnings: [/^node_modules\//],
        }),
      ).toEqual(['skip "src/ignored.ts", issuers: "src/index.ts"']);
    });
  });
});
