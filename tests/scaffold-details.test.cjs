// Run with: node --test tests/scaffold-details.test.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {test} = require('node:test');

const workspace = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(workspace, 'autoCount(20190904)_活潑版.html'), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const start = script.indexOf('const SPACINGS');
const end = script.indexOf('// 表單與結果');
assert.ok(start >= 0 && end > start, 'Pure calculation section must exist');
const context = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(workspace, 'material-weights_活潑版.js'), 'utf8'), context);
vm.runInContext('"use strict";\n' + script.slice(start, end) +
  '\nglobalThis.api = {calculateMaterials, SPACINGS, MATERIALS};', context);
const {calculateMaterials, SPACINGS, MATERIALS} = context.api;
const codes = Array.from(MATERIALS, ([code]) => code);
const base = {
  spacingX: 1.5, spacingY: 1.5, lengthX: 6, lengthY: 6,
  h1: 4, h2: 4, h3: 4, h4: 4, baseHeight: 0.2, frameHeight: 3,
  xGaps: null, yGaps: null, xBraces: null, yBraces: null
};
const plain = value => JSON.parse(JSON.stringify(value));

function physicalPositions(gaps) {
  let position = 0;
  return Array.from(gaps).slice(0, -1).map(gap => (position += gap));
}

function checkDetails(input) {
  const before = JSON.stringify(input);
  const unrecorded = Array.from(calculateMaterials(input));
  const details = {};
  const recorded = Array.from(calculateMaterials(input, details));
  assert.deepEqual(recorded, unrecorded, 'Capturing geometry must not change quantities');
  assert.deepEqual(Array.from(details.quantities), recorded);
  assert.equal(JSON.stringify(input), before, 'Capturing details must not mutate the input');
  assert.deepEqual(plain(details.input), input);
  assert.equal(details.truncated, false, 'These ordinary layouts must retain every link');

  const countX = details.xGaps.length - 1;
  const countY = details.yGaps.length - 1;
  const positionsX = physicalPositions(details.xGaps);
  const positionsY = physicalPositions(details.yGaps);
  assert.equal(details.heights.length, countX + 2);
  for (let x = 1; x <= countX; x++) {
    assert.equal(details.heights[x].length, countY + 2);
    for (let y = 1; y <= countY; y++) {
      assert.ok(Number.isFinite(Number(details.heights[x][y])), `Finite height required at ${x},${y}`);
    }
  }

  const totals = Array(codes.length).fill(0);
  assert.deepEqual(Object.keys(details.verticalCounts).sort(), codes.slice(0, 10).sort());
  for (const [code, matrix] of Object.entries(details.verticalCounts)) {
    assert.equal(matrix.length, countX + 2);
    for (const column of matrix) {
      assert.equal(column.length, countY + 2);
      for (const quantity of column) {
        assert.ok(Number.isSafeInteger(quantity) && quantity >= 0, 'Every vertical quantity must be a nonnegative integer');
        totals[codes.indexOf(code)] += quantity;
      }
    }
  }
  for (const [links, firstType, lastType] of [[details.rails, 10, 14], [details.diagonals, 15, 19]]) {
    for (const link of links) {
      assert.ok(['X', 'Y'].includes(link.axis));
      const alongCount = link.axis === 'X' ? countX : countY;
      const rowCount = link.axis === 'X' ? countY : countX;
      assert.ok(Number.isInteger(link.row) && link.row >= 1 && link.row <= rowCount, 'Link row must identify a physical support');
      assert.ok(Number.isInteger(link.startIndex) && link.startIndex >= 1, 'Link start must exclude the boundary sentinel');
      assert.ok(Number.isInteger(link.endIndex) && link.endIndex <= alongCount, 'Link end must exclude the boundary sentinel');
      assert.equal(link.endIndex, link.startIndex + 1, 'Links must connect adjacent physical supports');
      assert.ok(Number.isInteger(link.typeIndex) && link.typeIndex >= firstType && link.typeIndex <= lastType);
      assert.ok(Number.isSafeInteger(link.count) && link.count > 0);
      assert.ok(Number.isFinite(link.clearHeight) && link.clearHeight > 0);
      const positions = link.axis === 'X' ? positionsX : positionsY;
      const distance = positions[link.endIndex - 1] - positions[link.startIndex - 1];
      assert.ok(Math.abs(distance - SPACINGS[link.typeIndex - firstType]) < 1e-9,
        'The recorded material size must match its physical span');
      totals[link.typeIndex] += link.count;
    }
  }
  assert.deepEqual(totals, recorded, 'Vertical grids and every rail/diagonal event must reconstruct all 20 quantities');
  return details;
}

const layouts = [
  ['standard flat grid', {}],
  ['fine unequal axes with rising plane', {spacingX: 0.6, spacingY: 0.9, lengthX: 4.8, lengthY: 6.3,
    h1: 2, h2: 5, h3: 3, h4: 6}],
  ['wide unequal axes with descending plane', {spacingX: 1.8, spacingY: 2.4, lengthX: 7.2, lengthY: 9.6,
    h1: 6, h2: 3, h3: 5, h4: 2}],
  ['independent slopes on unequal axes', {spacingX: 2.4, spacingY: 0.6, lengthX: 8, lengthY: 4.8,
    h1: 4, h2: 4.7, h3: 5, h4: 7}],
  ['custom X gaps with automatic Y gaps', {xGaps: [0.6, 0.9, 1.5, 2.4], spacingY: 1.8, lengthY: 7.2,
    h1: 2, h2: 5, h3: 3, h4: 6}],
  ['custom Y gaps and explicit brace positions', {spacingX: 0.9, lengthX: 5.4,
    yGaps: [0.9, 1.8, 0.6], xBraces: [1, 3], yBraces: [1, 3], h1: 3, h2: 5, h3: 4, h4: 6}],
  ['custom gaps and braces on both axes', {xGaps: [0.6, 0.9, 1.5, 2.4], yGaps: [1.8, 0.6, 1.5],
    xBraces: [1, 2, 4], yBraces: [1, 3], h1: 2, h2: 4, h3: 2.3, h4: 6}]
];

for (const [name, changes] of layouts) {
  for (const frameHeight of [1.5, 3]) {
    test(`${name}, ${frameHeight} m main frame`, () => checkDetails({...base, ...changes, frameHeight}));
  }
}

test('6 × 6 m default layout has 25 physical supports between 0.3 and 5.7 m', () => {
  const details = checkDetails({...base});
  const x = physicalPositions(details.xGaps);
  const y = physicalPositions(details.yGaps);
  assert.equal(x.length * y.length, 25);
  assert.ok(Math.abs(x[0] - 0.3) < 1e-9);
  assert.ok(Math.abs(x.at(-1) - 5.7) < 1e-9);
  assert.ok(Math.abs(y[0] - 0.3) < 1e-9);
  assert.ok(Math.abs(y.at(-1) - 5.7) < 1e-9);
});

test('reusing a details object replaces old links and keeps its quantity snapshot separate', () => {
  const details = {};
  calculateMaterials({...base, spacingX: 0.6, spacingY: 0.6}, details);
  const expected = {};
  calculateMaterials({...base}, expected);
  const quantities = calculateMaterials({...base}, details);
  assert.deepEqual(plain(details), plain(expected));
  quantities[0] += 1;
  assert.notEqual(details.quantities[0], quantities[0]);
});
