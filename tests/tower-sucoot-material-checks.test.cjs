const assert = require('node:assert/strict');
const {test} = require('node:test');
require('../tower-foundation.js');
require('../tower-support.js');
require('../tower-sucoot-material-checks.js');

const {TowerFoundation, TowerSupport, TowerSucootMaterialChecks: method} = globalThis;
const {e, fb, fv} = {e: 70000, fb: 140, fv: 12};
const board = {...TowerFoundation.rectangleSection(1000, 18), height: 0.018, e, fb, fv, shearArea: 180};
const timber = {...TowerFoundation.rectangleSection(60, 75), height: 0.075, width: 0.06, e, fb, fv, shearArea: 45};
const steel = {height: 0.2, width: 0.1, Z: 181, I: 1810,
  e: 2040000, fy: 2520, fb: 1512, fv: 1008, shearArea: 11};
const pressure = 2.4 * 1.8 + 0.2 + 0.2;

test('three material checks reproduce the reference worksheet results', () => {
  for (const [type, section, span, width, figures, deflectionLimit] of [
    ['board', board, 0.2, 1, ['34.96', '2.62', '0.017'], 0.30],
    ['timber', timber, 0.9, 0.2, ['136', '9.4', '0.33'], 0.375],
    ['steel', steel, 1.5, 0.9, ['528', '289.6', '0.046'], 0.30]
  ]) {
    const rows = method.checks(type, section, span, pressure * width * 10);
    assert.equal(rows[2].limit, deflectionLimit);
    assert.deepEqual(rows.map(({demand}, i) => demand.toFixed((figures[i].split('.')[1] ?? '').length)), figures);
  }
});

test('reference checks drive joist spacing and steel capacity only when explicitly selected', () => {
  const shape = TowerFoundation.calculate({...TowerFoundation.example, width: 1400, projection: 4000,
    innerDepth: 1800, outerDepth: 1800});
  const catalog = [0.6, 0.9, 1.5, 1.8, 2.4].flatMap(size => [
    {code: 'H' + size, kind: 'rail', size},
    {code: 'D' + size, kind: 'brace', rise: 1.5, size}
  ]);
  const inputs = {board, timber, steel, concrete: 2.4, impact: 0.2, live: 0.2, legCapacity: 15, sideExtension: 0};
  const buildFrame = () => ({members: [], issues: []});
  const reference = TowerSupport.plan(shape, {...inputs, materialMethod: method}, catalog, buildFrame);
  assert.equal(reference.armFrames.length, 4);
  const refArm = reference.armFrames[0];
  assert.ok(refArm.joistPitch <= 0.20);
  assert.equal(refArm.screening.steelFactor, 1);
  assert.equal(refArm.steelSupportSpan, method.spanLimit('steel', steel, Math.max(...refArm.steelLineLoads) * 10));
  for (const checks of Object.values(TowerSupport.getMaterialChecks(reference, refArm))) {
    assert.ok(checks.every(({demand, limit}) => demand <= limit + 1e-8));
  }

  const legacy = TowerSupport.plan(shape, inputs, catalog, buildFrame);
  const legacyArm = legacy.armFrames[0];
  assert.ok(legacyArm.screening.steelFactor > 1);
  assert.equal(TowerSupport.getMaterialChecks(legacy, legacyArm).board[2].limit,
    legacyArm.screening.boardSpanLength * 100 / 240);
});
