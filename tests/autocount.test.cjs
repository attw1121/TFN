// Run with: node --test tests/autocount.test.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test, describe } = require('node:test');

for (const filename of ['autoCount(20190904).html', 'autoCount(20190904)_優化版.html', 'autoCount(20190904)_活潑版.html']) {
describe(filename, () => {
const html = fs.readFileSync(path.join(__dirname, '..', filename), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const context = vm.createContext({});
if (filename.includes('_優化版') || filename.includes('_活潑版')) {
  const weightsFile = filename.includes('_活潑版') ? 'material-weights_活潑版.js' : 'material-weights.js';
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', weightsFile), 'utf8'), context);
}
// Load the pure calculations without creating a browser or changing the production API.
const start = script.indexOf('const SPACINGS');
const end = script.indexOf('// 表單與結果');
assert.ok(start >= 0 && end > start, 'Calculation section must exist');
vm.runInContext('"use strict";\n' + script.slice(start, end) +
  '\nglobalThis.calculations = { calculateMaterials, buildAxis, countDiagonal, MATERIALS };', context);
const { calculateMaterials, buildAxis, countDiagonal, MATERIALS } = context.calculations;

const base = {
  spacingX: 1.5, spacingY: 1.5, lengthX: 6, lengthY: 6,
  h1: 4, h2: 4, h3: 4, h4: 4, baseHeight: 0.2, frameHeight: 3,
  xGaps: null, yGaps: null, xBraces: null, yBraces: null
};

// Reference quantities retain the existing material rules and cover the corrected defects.
const fixtures = [
  ['flat layout', {},
    [0,0,25,0,0,25,0,25,25,25,0,40,120,0,0,0,0,60,0,0]],
  ['0.9 m margins', {spacingX: 0.9, spacingY: 0.9},
    [0,0,49,0,0,49,0,49,49,49,0,336,0,0,0,0,112,0,0,0]],
  ['independent edge slopes', {h3: 2, h4: 6},
    [0,6,19,7,2,18,3,25,25,25,0,35,107,0,0,0,0,68,0,0]],
  ['sleeve height condition', {spacingY: 0.6, h1: 2, h2: 5, h3: 3, h4: 6, frameHeight: 1.5},
    [0,50,0,14,41,29,13,50,50,50,161,32,98,0,0,53,0,74,0,0]],
  ['custom mixed gaps', {h1: 2, h2: 5, h3: 3, h4: 6, xGaps: [0.6,0.9,1.5,2.4], yGaps: [1.8,0.6,1.5]},
    [1,10,9,5,3,18,6,20,20,20,31,13,30,17,15,5,0,20,9,12]],
  ['custom braces on slopes', {h1: 2, h2: 4, h3: 2.3, h4: 6, frameHeight: 3,
    xGaps: [0.6,0.9,1.5,2.4], yGaps: [1.8,0.6,1.5], xBraces: [1,2], yBraces: [1,2]},
    [1,12,7,3,2,15,3,20,20,20,24,11,29,15,13,12,5,0,8,0]],
  ['custom braces on flat layout', {xBraces: [1,2], yBraces: [1,2]},
    [0,0,25,0,0,25,0,25,25,25,0,40,120,0,0,0,20,20,0,0]]
];

for (const [name, changes, expected] of fixtures) {
  test(name, () => {
    const input = {...base, ...changes};
    assert.deepEqual(Array.from(calculateMaterials(input)), expected);
  });
}

test('repeated calculations keep inputs and global state unchanged', () => {
  const input = {...base, xGaps: [0.6,0.9,1.5], xBraces: [1]};
  const snapshot = JSON.stringify(input);
  const keys = Object.keys(context);
  const first = Array.from(calculateMaterials(input));
  calculateMaterials({...base, h1: 7, h2: 8, h3: 9, h4: 10});
  assert.deepEqual(Array.from(calculateMaterials(input)), first);
  assert.equal(JSON.stringify(input), snapshot);
  assert.deepEqual(Object.keys(context), keys);
});

test('custom braces do not inherit the preceding point count', () => {
  assert.ok(countDiagonal(4) > 0);
  assert.equal(countDiagonal(1.5), 0);
  assert.equal(countDiagonal(1), 0);
});

test('0.9 m Y margins retain the complete support length', () => {
  const gaps = Array.from(buildAxis(0.9, 6.3, null));
  assert.ok(Math.abs(gaps.reduce((sum, gap) => sum + gap, 0) - 6.3) < 1e-9);
});

test('flat layout weight is 1917.95 kg', () => {
  const quantities = calculateMaterials(base);
  const weight = MATERIALS.reduce((sum, [, unitWeight], index) =>
    sum + Number((quantities[index] * unitWeight).toFixed(2)), 0);
  assert.equal(weight.toFixed(2), '1917.95');
});
});
}
