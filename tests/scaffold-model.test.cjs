const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {test} = require('node:test');

const root = path.join(__dirname, '..');
const context = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(root, 'material-weights_活潑版.js'), 'utf8'), context);
vm.runInContext(fs.readFileSync(path.join(root, 'scaffold-model.js'), 'utf8'), context);
const html = fs.readFileSync(path.join(root, 'autoCount(20190904)_活潑版.html'), 'utf8');
const script = Array.from(html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g), match => match[1]).find(value => value.includes('function calculateMaterials('));
assert.ok(script, 'Live calculation script must exist');
const pure = script.slice(script.indexOf('const SPACINGS'), script.indexOf('// 表單與結果'));
vm.runInContext(pure + '\nglobalThis.calculate = calculateMaterials;', context);
const {fromCalculation, parseCSV, toCSV, COLORS} = context.ScaffoldModel;
const input = {spacingX: 1.5, spacingY: 1.5, lengthX: 6, lengthY: 6,
  h1: 4, h2: 4, h3: 4, h4: 4, baseHeight: 0.2, frameHeight: 3,
  xGaps: null, yGaps: null, xBraces: null, yBraces: null};
function calculate(changes = {}) {
  const details = {};
  const quantities = context.calculate({...input, ...changes}, details);
  return {details, quantities, model: fromCalculation(details)};
}
const plain = value => JSON.parse(JSON.stringify(value));
const distance = member => Math.hypot(...member.start.map((value, index) => member.end[index] - value));

test('flat configuration creates every counted member at physical support coordinates', () => {
  const {model, quantities} = calculate();
  assert.equal(model.members.length, 345);
  assert.deepEqual(Array.from(model.quantities), Array.from(quantities));
  assert.equal(new Set(model.members.map(member => member.id)).size, 345);
  assert.deepEqual(Array.from(model.bounds.min), [0.3, 0.3, 0]);
  assert.deepEqual(Array.from(model.bounds.max), [5.7, 5.7, 4]);
  assert.ok(model.members.every(member => member.source === 'inferred'));
  assert.ok(model.members.filter(member => member.code === 'V60300').every(member => Math.abs(distance(member) - 3) < 1e-8));
  assert.ok(model.members.filter(member => member.code === 'V62025').every(member => Math.abs(distance(member) - 0.25) < 1e-8));
});

test('custom spans and different corner heights retain quantity and endpoint positions', () => {
  const {model, quantities} = calculate({xGaps: [0.6,0.9,1.5], yGaps: [1.8,0.6], h2: 5, h3: 4.5, h4: 6});
  assert.deepEqual(Array.from(model.quantities), Array.from(quantities));
  assert.deepEqual(Array.from(model.bounds.min), [0,0,0]);
  const corner = model.members.find(member => member.code === 'U48601' && member.start[0] === 3 && member.start[1] === 2.4);
  assert.ok(corner);
  assert.equal(corner.end[2], 6);
  assert.equal(model.members.filter(member => member.code === 'J48601').length, 12);
});

test('3 m main frames near the short-sleeve threshold never subtract a missing long sleeve', () => {
  for (const height of [3.47, 3.48, 3.5, 3.54]) {
    const {details, model, quantities} = calculate({h1: height, h2: height, h3: height, h4: height});
    assert.ok(Array.from(quantities).every(quantity => Number.isSafeInteger(quantity) && quantity >= 0));
    assert.deepEqual(Array.from(quantities).slice(0, 10), [0,25,0,25,0,25,0,25,25,25]);
    assert.deepEqual(Array.from(model.quantities), Array.from(quantities));
    assert.equal(model.members.filter(member => member.code === 'V60150').length, 25);
    assert.equal(model.members.filter(member => member.code === 'V61100').length, 25);
    assert.equal(model.members.filter(member => member.code === 'V62025').length, 25);
    assert.equal(model.members.filter(member => member.code === 'V61150').length, 0);
    for (const grid of Object.values(details.verticalCounts)) {
      assert.ok(grid.every(row => row.every(quantity => Number.isSafeInteger(quantity) && quantity >= 0)));
    }
    assert.ok(!model.issues.some(issue => issue.includes('超出設定支撐高度')));
  }
});

test('zero adjustment and impossible nominal heights remain explicit instead of shortening rods', () => {
  const zero = calculate({baseHeight: 0}).model;
  assert.ok(zero.issues.some(issue => issue.includes('J48601')));
  const low = calculate({h1: 0.5, h2: 0.5, h3: 0.5, h4: 0.5}).model;
  assert.ok(low.issues.some(issue => issue.includes('超出設定支撐高度')));
  assert.ok(low.members.filter(member => member.code === 'V60100').every(member => Math.abs(distance(member) - 1) < 1e-8));
  assert.ok(low.members.every(member => member.start[2] >= 0 && member.end[2] >= 0));
});

test('quantity mismatch, truncated data, and missing physical spans cannot yield misleading geometry', () => {
  const {details} = calculate();
  assert.throws(() => fromCalculation({...details, truncated: true}), /上限/);
  const wrong = Array.from(details.quantities); wrong[0]++;
  assert.throws(() => fromCalculation({...details, quantities: wrong}), /不一致/);
  assert.throws(() => fromCalculation({...details, xGaps: [0.6,0.6]}), /至少需要一跨/);
});

test('catalog uses 20 distinct hex colors', () => {
  assert.equal(Object.keys(COLORS).length, 20);
  assert.equal(new Set(Object.values(COLORS)).size, 20);
  assert.ok(Object.values(COLORS).every(color => /^#[0-9A-F]{6}$/.test(color)));
});

test('CSV accepts BOM, CRLF, quotes, reordered fields and unknown member types', () => {
  const csv = '\uFEFFcode,id,z2,y2,x2,z1,y1,x1,note\r\n"CUSTOM_A","",3,2,1,-3,-2,-1,"quoted ""note"", and newline\ninside"\r\nV60300,MEMBER-000001,3,0,0,0,0,0,""\r\n';
  const model = parseCSV(csv);
  assert.equal(model.members.length, 2);
  assert.equal(model.source, 'coordinates');
  assert.equal(model.members[0].id, 'MEMBER-000002');
  assert.equal(model.members[0].kind, 'other');
  assert.deepEqual(Array.from(model.members[0].start), [-1,-2,-3]);
  assert.deepEqual(Array.from(model.members[0].end), [1,2,3]);
  assert.ok(/^#[0-9A-F]{6}$/.test(model.colors.CUSTOM_A));
});

test('coordinate CSV round-trip retains every member and endpoint', () => {
  const {model} = calculate();
  const restored = parseCSV(toCSV(model));
  assert.deepEqual(plain(restored.members.map(({id, code, start, end}) => ({id,code,start,end}))),
    plain(model.members.map(({id, code, start, end}) => ({id,code,start,end}))));
});

test('invalid CSV fails as a whole for incomplete or unsafe coordinates and identity', () => {
  const header = 'id,code,x1,y1,z1,x2,y2,z2\n';
  for (const row of [
    'A,V60300,,0,0,1,0,0', 'A,V60300,NaN,0,0,1,0,0',
    'A,V60300,0,0,0,0,0,0', 'A,V60300,0,0,0,1000000001,0,0',
    'A,V60300,0,0,0,1,0', '=SUM,V60300,0,0,0,1,0,0',
    'A,=FORMULA,0,0,0,1,0,0', 'A,V60300,0,0,0,1,0,0\nA,V60300,0,1,0,1,1,0',
    '"A,V60300,0,0,0,1,0,0', '"A"bad,V60300,0,0,0,1,0,0'
  ]) assert.throws(() => parseCSV(header + row), undefined, row);
  assert.throws(() => parseCSV('code,x1,y1,z1,x2,y2,z2\nV60300,0,0,0,1,0,0'), /欄位/);
});

test('CSV member count is bounded and exported notes cannot begin with formulas', () => {
  const tooMany = 'id,code,x1,y1,z1,x2,y2,z2\n' + Array.from({length: 50001}, (_, index) => 'M' + index + ',X,0,0,0,1,0,0').join('\n');
  assert.throws(() => parseCSV(tooMany), /50,000/);
  const model = parseCSV('id,code,x1,y1,z1,x2,y2,z2\nA,TYPE_X,0,0,0,1,0,0');
  model.members[0].note = '=1+1';
  const csv = toCSV(model);
  assert.ok(csv.includes('"\'=1+1"'));
  assert.equal(parseCSV(csv).members.length, 1);
});
