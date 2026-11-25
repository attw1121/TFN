const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const {test} = require('node:test');
const vm = require('node:vm');

const read = file => readFileSync(join(__dirname, '..', file), 'utf8');

for (const file of ['ACT20261119-03.html', 'ACD20261119-02.html', 'ACT20261120.html']) {
  test(file + ' fits the upper jack and updates the assembled parts', () => {
    const [assembly, calculator] = Array.from(
      read(file).matchAll(/<script>([\s\S]*?)<\/script>/g), match => match[1]
    );
    const context = vm.createContext({});
    vm.runInContext(read('scaffold-model.js'), context);
    vm.runInContext(assembly, context);
    vm.runInContext(
      calculator.slice(calculator.indexOf('const SPACINGS'), calculator.indexOf('// 表單與結果')) +
      calculator.slice(calculator.indexOf('const defaultSizes'), calculator.indexOf('let catalog = defaults;')) +
      'const catalog = defaults; function invalid(message) { throw new Error(message); }' +
      'globalThis.calculate = calculateMaterials;', context
    );

    function inputFor(height) {
      return {
        spacingX: 1.5, spacingY: 1.5, lengthX: 3, lengthY: 3,
        h1: height, h2: height, h3: height, h4: height, baseHeight: 0.2, frameHeight: 1.5,
        xGaps: null, yGaps: null, xBraces: null, yBraces: null
      };
    }

    assert.throws(() => context.calculate(inputFor(1.479)), /8 cm|不符規則/);
    const currentACT = file === 'ACT20261120.html';
    const cases = currentACT ? [
      [1.48, 0.08, ['V60100']],
      [1.75, 0.35, ['V60100']],
      [1.799, 0.399, ['V60100']],
      [1.8, 0.15, ['V60100', 'V62025']],
      [1.801, 0.151, ['V60100', 'V62025']],
      [2.051, 0.151, ['V60150']],
      [3.05, 0.15, ['V60150', 'V61100']]
    ] : [
      [1.48, 0.08, ['V60100']],
      [1.749, 0.349, ['V60100']],
      [1.75, 0.1, ['V60100', 'V62025']],
      [1.751, 0.101, ['V60100', 'V62025']],
      [2, 0.1, ['V60150']],
      [3, 0.1, ['V60150', 'V61100']]
    ];
    for (const [height, extension, expectedStack] of cases) {
      const {geometry} = context.calculate(inputFor(height));
      const {members} = context.ScaffoldACT.build(geometry);
      const jacks = members.filter(member => member.code === 'U48601');
      assert.equal(jacks.length, geometry.supports.length);
      for (const {start, end} of jacks) {
        assert.ok(Math.abs(end[2] - start[2] - extension) < 1e-8, String(height));
        assert.ok(Math.abs(end[2] - height) < 1e-8, String(height));
      }
      const stack = Array.from(geometry.supports[0].parts.slice(2, -1),
        ([index]) => geometry.catalog[index].code);
      assert.deepEqual(stack, expectedStack);
    }

    if (currentACT) {
      vm.runInContext(
        calculator.slice(calculator.indexOf('  function calculateWithBaseAdjustment'),
          calculator.indexOf('  function showCalculation')) +
        'globalThis.calculateKeepingMaterials = calculateKeepingMaterials;', context
      );
      const adjust = (height, minUpperJack = 0.08, overrides = {}) =>
        context.calculateKeepingMaterials({...inputFor(height), minUpperJack, ...overrides}).calculation.geometry;
      assert.equal(adjust(1.75).base, 0.2);
      for (const [height, minimum, expectedExtension, expectedStack] of [
        [1.75, 0.08, 0.35, ['V60100']],
        [1.76, 0.11, 0.11, ['V60100', 'V62025']],
        [1.76, 0.12, 0.36, ['V60100']],
        [3, 0.10, 0.35, ['V60150', 'V62050', 'V62025']],
        [3.01, 0.11, 0.11, ['V60150', 'V61100']],
        [3.01, 0.12, 0.36, ['V60150', 'V62050', 'V62025']]
      ]) {
        const geometry = adjust(height, minimum);
        assert.equal(geometry.base, 0.2);
        const stack = Array.from(geometry.supports[0].parts.slice(2, -1),
          ([index]) => geometry.catalog[index].code);
        assert.deepEqual(stack, expectedStack);
        const jack = context.ScaffoldACT.build(geometry).members.find(member => member.code === 'U48601');
        assert.ok(Math.abs(jack.end[2] - jack.start[2] - expectedExtension) < 1e-8);
      }
      assert.equal(adjust(1.45).base, 0.17);
      assert.equal(adjust(1.36).base, 0.08);
      assert.throws(() => adjust(1.359), {
        message: /下調整座高度至少 8 cm/
      });
      const lowered = adjust(1.8, 0.2);
      assert.equal(lowered.base, 0.15);
      assert.deepEqual(lowered.supports, adjust(1.8).supports);
      for (const member of context.ScaffoldACT.build(lowered).members.filter(part => part.code === 'U48601')) {
        const extension = member.end[2] - member.start[2];
        assert.ok(extension >= 0.2 - 1e-8 && extension < 0.4);
      }
      const layout = {...inputFor(2.6), h1: 2.54, xGaps: [1.5, 1.5], yGaps: [1.5, 1.5]};
      const previous = context.calculateKeepingMaterials({...layout, minUpperJack: 0.15}).calculation;
      const updated = context.calculateKeepingMaterials(
        {...layout, baseHeight: previous.geometry.base, minUpperJack: 0.2}, previous
      );
      assert.equal(updated.warning, undefined);
      const changed = updated.calculation.geometry;
      let replacements = 0;
      let retained = 0;
      for (const {i, j, parts} of previous.geometry.supports) {
        const next = changed.supports.find(support => support.i === i && support.j === j);
        const stack = parts.reduce((height, [index, amount]) =>
          index === 8 || index === 9 ? height : height + changed.catalog[index].size * amount, 0);
        const extension = changed.heights[i][j] - stack - changed.base;
        if (extension >= 0.2 - 1e-7 && extension < 0.4 - 1e-7) {
          assert.deepEqual(next.parts, parts);
          retained++;
        } else {
          assert.notDeepEqual(next.parts, parts);
          replacements++;
        }
      }
      assert.ok(retained > 0 && replacements > 0);
      for (const {start, end} of context.ScaffoldACT.build(changed).members.filter(part => part.code === 'U48601')) {
        assert.ok(end[2] - start[2] >= 0.2 - 1e-8 && end[2] - start[2] < 0.4);
      }
      const firstRun = context.calculateKeepingMaterials({...inputFor(1.36), minUpperJack: 0.09});
      assert.match(firstRun.warning, /已保留原配置與桿件/);
      assert.equal(firstRun.calculation.geometry.base, 0.08);
      assert.deepEqual(firstRun.calculation.geometry.supports, adjust(1.36).supports);

      for (const corner of ['h1', 'h2', 'h3', 'h4']) {
        const slope = adjust(3.6, 0.08, {[corner]: 2.6, xGaps: [1.5, 1.5], yGaps: [1.5, 1.5]});
        const {members} = context.ScaffoldACT.build(slope);
        const discs = members.filter(member => member.note === '50 cm 輔助桿圓盤接點。');
        const auxiliary = members.filter(member => member.code === 'V62050');
        const axes = new Set();
        for (const {start, end} of discs) {
          assert.equal(start[2], end[2]);
          assert.ok([start, end].some(([x, y, z]) => auxiliary.some(({start: rod}) =>
            rod[0] === x && rod[1] === y && Math.abs(rod[2] + 0.4 - z) < 1e-8)));
          axes.add(start[0] === end[0] ? 'Y' : 'X');
        }
        assert.deepEqual(axes, new Set(['X', 'Y']), corner);
      }
    }
  });
}
