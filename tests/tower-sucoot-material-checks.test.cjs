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

test('bedding sections and independent checks update with the selected dimensions and span', () => {
  const wood = TowerFoundation.beddingSection('timber', [150, 90]);
  assert.deepEqual(wood, {A: 135, I: 2531.25, Z: 337.5});
  assert.deepEqual(TowerFoundation.beddingSection('timber', [100, 90]), {A: 90, I: 750, Z: 150});
  assert.equal(TowerFoundation.beddingSection('channel', [100, 50, 5, 7.5]).A, 11.75);
  assert.equal(TowerFoundation.beddingSection('tube', [100, 100, 10]).A, 36);
  assert.equal(TowerFoundation.beddingSection('tube', [100, 100, 50]), null);
  const section = {...wood, shearArea: 90, e: 70000, fb: 150, fv: 12};
  const conditions = {span: 2000, load: 0.2, deflection: 3, cantilever: false};
  const rows = method.beddingChecks(section, conditions);
  assert.deepEqual(rows.map(row => row.demand.toFixed(4)), ['29.6296', '2.2222', '0.2352']);
  assert.equal(rows[2].limit, 0.3);
  assert.equal(method.beddingChecks(section, {...conditions, cantilever: true})[0].demand, rows[0].demand * 4);
  assert.deepEqual(method.beddingChecks({...section, shearArea: NaN}, conditions), []);
});

test('mixed bedding automatically sizes a grid and conserves the beam and platform load through each layer', () => {
  const shape = TowerFoundation.calculate(TowerFoundation.example);
  const layers = [
    {...TowerFoundation.beddingSection('timber', [150, 90]), type: 'timber', name: '角木', direction: 'across',
      height: 0.15, width: 0.09, e, fb: 150, fv, shearArea: 90},
    {...TowerFoundation.beddingSection('channel', [150, 75, 6.5, 10]), type: 'channel', name: '槽鋼', direction: 'along',
      height: 0.15, width: 0.075, e: 2040000, fb: 1512, fv: 1008, shearArea: 8.45},
    {...TowerFoundation.beddingSection('tube', [150, 150, 6]), type: 'tube', name: '方鋼管', direction: 'across',
      height: 0.15, width: 0.15, e: 2040000, fb: 1512, fv: 1008, shearArea: 16.56}
  ];
  const catalog = [0.6, 0.9, 1.5, 1.8, 2.4].flatMap(size => [
    {code: 'H' + size, kind: 'rail', size}, {code: 'D' + size, kind: 'brace', size, rise: 1.5}
  ]);
  const options = {board: {...board, ...TowerFoundation.rectangleSection(1000, 21), height: 0.021},
    layered: layers, materialMethod: method, concrete: 2.4, impact: 0.2, live: 0.2, legCapacity: 8};
  const buildFrame = () => ({members: [], issues: []});
  const layout = TowerSupport.plan(shape, options, catalog, buildFrame);
  assert.ok(layout.armFrames, layout.message);
  assert.equal(layout.armFrames.length, 4);
  const arm = layout.armFrames[0];
  const {footLoads} = arm.bedding;
  const sum = footLoads.flat().reduce((total, load) => total + load, 0);
  const applied = (layout.pressure * layout.width + layout.platformPressure * 2 * layout.sideExtension) * layout.length;
  assert.ok(Math.abs(sum - applied) < 1e-8);
  assert.equal(footLoads.length, arm.frameAlong.positions.length);
  assert.ok(footLoads.every(row => row.length === arm.frameAcross.positions.length));
  assert.equal(arm.governingLeg.transferredLoad, arm.peakLegLoad);
  for (const checks of TowerSupport.getMaterialChecks(layout, arm).bedding) {
    assert.equal(checks.length, 3);
    assert.ok(checks.every(({force, limit, demand}) => force >= 0 && demand <= limit));
  }
  const weak = TowerSupport.plan(shape, {...options, layered: [...layers.slice(0, 2), {...layers[2], fb: 1}]}, catalog, buildFrame);
  assert.match(weak.message, /沒有同時符合/);
});

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

test('Sucoot material checks allow joist spacing above 200 mm when capacity permits', () => {
  const shape = TowerFoundation.calculate({...TowerFoundation.example, width: 1400, projection: 4000,
    innerDepth: 1800, outerDepth: 1800});
  const catalog = [0.6, 0.9, 1.5, 1.8, 2.4].flatMap(size => [
    {code: 'H' + size, kind: 'rail', size},
    {code: 'D' + size, kind: 'brace', rise: 1.5, size}
  ]);
  const inputs = {board, timber, steel, concrete: 2.4, impact: 0.2, live: 0.2, legCapacity: 15, sideExtension: 0};
  const buildFrame = () => ({members: [], issues: []});
  const deeperTimber = {...timber, ...TowerFoundation.rectangleSection(60, 85), height: 0.085};
  const reference = TowerSupport.plan(shape, {...inputs, timber: deeperTimber, materialMethod: method}, catalog, buildFrame);
  assert.equal(reference.armFrames.length, 4);
  const refArm = reference.armFrames[0];
  assert.equal(refArm.joistPitch, 0.25);
  assert.ok(refArm.joistPitch <= refArm.screening.timberLimit);
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
