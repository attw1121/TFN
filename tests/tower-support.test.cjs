const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const {test} = require('node:test');
const {runInThisContext} = require('node:vm');
require('../tower-foundation.js');
require('../tower-support.js');
require('../scaffold-sucoot.js');

const actPage = readFileSync(join(__dirname, '../ACT20261123.html'), 'utf8');
const [assembly, calculator] = [...actPage.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match => match[1]);
runInThisContext(assembly);

const {TowerFoundation, TowerSupport} = globalThis;
const shape = TowerFoundation.calculate({...TowerFoundation.example, width: 1400, projection: 4000});
const catalog = [0.6, 0.9, 1.5, 1.8, 2.4].flatMap(size => [
  {code: 'H' + size, kind: 'rail', size},
  {code: 'D' + size, kind: 'brace', rise: 1.5, size}
]);
const wood = {e: 1e6, fb: 1000, fv: 200};
const board = {...TowerFoundation.rectangleSection(1000, 30), ...wood, height: 0.03, shearArea: 200};
const timber = {...TowerFoundation.rectangleSection(90, 160), ...wood, height: 0.16, width: 0.09, shearArea: 96};
const steelProfile = TowerFoundation.steelProfiles.find(([h, b, web]) => h === 200 && b === 100 && web === 5.5);
const steel = {...TowerFoundation.steelSection(steelProfile), height: 0.2, width: 0.1, e: 2040000, fy: 2520,
  fb: 1512, fv: 1008, shearArea: 11, webSlenderness: 168 / 5.5};
const loads = {concrete: 2.4, impact: 0.2, live: 0.2, legCapacity: 15, sideExtension: 0, board, timber, steel};
const buildFrame = () => ({members: [], issues: []});

test('part statistics aggregate placed members by beam and use catalog weights', () => {
  const frame = codes => ({members: codes.map(code => ({code}))});
  const arms = [
    {arm: 'a', frame: frame(['H66060', 'J60350', 'J60350'])},
    {arm: 'c', frame: frame(['H66060', 'H66060', 'V62025'])}
  ];
  const catalogWeights = new Map([['H66060', {weight: 2.4}], ['J60350', {weight: 3.04}]]);
  const {byBeam, rows, totalQuantity, weight, hasMissingWeights} = TowerSupport.summarizeParts(arms, catalogWeights);
  assert.equal(byBeam.get('a').counts.get('J60350'), 2);
  assert.equal(byBeam.get('c').total, 3);
  assert.equal(byBeam.has('b'), false);
  assert.deepEqual(rows.map(row => [row.code, row.quantity, row.unitWeight]), [
    ['H66060', 3, 2.4], ['J60350', 2, 3.04], ['V62025', 1, null]
  ]);
  assert.equal(totalQuantity, 6);
  assert.ok(Math.abs(weight - 13.28) < 1e-9);
  assert.equal(hasMissingWeights, true);
});

test('two elevations at one station draw a vertical step and use the second value outward', () => {
  const {groundElevation, groundStations, makeModel} = TowerFoundation;
  const profile = {origin: 200, points: [[1000, 100], [1000, -200], [2000, -100], [2500, -100], [2500, 100]]};
  assert.equal(groundElevation(profile, 500), 250);
  assert.ok(groundElevation(profile, 999) > 299);
  assert.equal(groundElevation(profile, 1000), 0);
  assert.equal(groundElevation(profile, 1000 - 1e-10), 0);
  assert.equal(groundElevation(profile, 1500), 50);
  assert.equal(groundElevation(profile, 2500), 300);
  assert.equal(groundElevation(profile, 2600), 300);
  assert.deepEqual(groundStations(profile, 1000), [[0, 200], [1000, 300], [1000, 0]]);
  assert.deepEqual(groundStations(profile, 750), [[0, 200], [750, 275]]);
  assert.deepEqual(makeModel(shape, {d: profile}).groundLines[0].slice(1, 3), [[4, 0, 0.3], [4, 0, 0]]);
});

test('a support station at a grade change uses the new elevation', () => {
  const baseline = TowerSupport.plan(shape, loads, catalog, buildFrame);
  const first = baseline.armFrames[0].frameAlong.positions[0] * 1000;
  const groundProfiles = {a: {origin: 0, points: [[first, 0], [first, -100]]}};
  const result = TowerSupport.plan(shape, {...loads, groundProfiles}, catalog, (_x, _y, _in, _out, levels) =>
    ({...buildFrame(), levels}));
  const arm = result.armFrames.find(({arm}) => arm === 'a');
  assert.equal(arm.frameAlong.positions[0] * 1000, first);
  assert.equal(arm.frame.levels[0], -0.1);
});

test('prefers the largest feasible H-steel bay even when a shorter bay needs fewer legs', () => {
  const shorter = TowerSupport.plan(shape, loads, catalog, xGaps => {
    if (Math.max(...xGaps) > 0.6) {
      throw Object.assign(new Error('Longitudinal span unavailable'), {towerFrameFit: true});
    }
    return buildFrame();
  });
  const layout = TowerSupport.plan(shape, loads, catalog, buildFrame);
  assert.equal(layout.armFrames.length, 4);
  for (const [i, arm] of layout.armFrames.entries()) {
    assert.equal(arm.x.nominal, 0.9);
    assert.equal(shorter.armFrames[i].x.nominal, 0.6);
    assert.ok(arm.legCount > shorter.armFrames[i].legCount);
  }
});

test('uses shorter bays when steel capacity falls and reports the horizontal limit', () => {
  const reducedSteel = {...steel, e: steel.e * 0.6, fb: steel.fb * 0.6};
  const layout = TowerSupport.plan(shape, {...loads, steel: reducedSteel}, catalog, buildFrame);
  assert.equal(layout.armFrames.length, 4);
  for (const arm of layout.armFrames) {
    assert.equal(arm.x.nominal, 0.6);
    assert.ok(arm.steelSupportSpan > 0.6 && arm.steelSupportSpan < 0.9);
    const horizontalSpan = arm.steelSupportSpan;
    const slopeFactor = Math.hypot(1, (shape.outerSoffit - shape.clearance) / shape.projection);
    const atLimit = {...arm, screening: {...arm.screening, steelSpan: horizontalSpan * slopeFactor,
      steelFactor: 2 * (1 + 2 * arm.screening.spanOffset / horizontalSpan)}};
    const utilization = TowerSupport.getMaterialChecks(layout, atLimit).steel.map(({demand, limit}) => demand / limit);
    assert.ok(Math.abs(Math.max(...utilization) - 1) < 1e-10);
  }
});

test('places the optional end-platform bay next to the well and keeps platform load at the tip', () => {
  const beamLength = shape.projection / 1000;
  const plan = options => TowerSupport.plan(shape, {...loads, ...options}, catalog, buildFrame).armFrames[0].frameAlong;
  const compact = plan({});
  assert.deepEqual(plan({endBayAtStart: true}), compact);
  for (const endExtension of [0.6, 0.9]) {
    const moved = plan({endExtension, endBayAtStart: true});
    assert.equal(moved.gaps[0], endExtension);
    assert.equal(moved.gaps.length + 1, moved.positions.length);
    assert.ok(Math.abs(moved.positions[1] - moved.positions[0] - endExtension) < 1e-9);
    assert.ok(moved.positions[0] >= 0.1 && moved.positions[0] <= endExtension / 2 + 1e-9);
    assert.ok(moved.positions.at(-1) >= beamLength + endExtension / 2 - 1e-9);
    assert.ok(moved.positions.at(-1) <= beamLength + endExtension - 0.1 + 1e-9);
    assert.ok(Math.abs(moved.strips.reduce((length, {beam}) => length + beam, 0) - beamLength) < 1e-9);
    assert.ok(Math.abs(moved.strips.reduce((length, {beam, total}) => length + total - beam, 0) - endExtension) < 1e-9);
    assert.equal(moved.strips[0].beam, moved.strips[0].total);
    assert.equal(plan({endExtension}).gaps.at(-1), endExtension);
  }
});

test('uses only the four short support stacks and fits the upper jack to the steel', () => {
  const shortCatalog = [...catalog, ...['V62025', 'V62050', 'U48601'].map(code => ({code, weight: 1}))];
  const noRegularFrame = () => { throw Object.assign(new Error('Conventional frame does not fit'), {towerFrameFit: true}); };
  const lowShape = net => TowerFoundation.calculate({...shape, outerDepth: shape.innerDepth,
    clearance: (net + board.height + timber.height + steel.height) * 1000});
  for (const [net, excluded, expected] of [
    [0.74, null, ['V62025']],
    [0.98, null, ['V62050']],
    [0.98, 'V62050', ['V62025', 'V62025']],
    [1.24, null, ['V62050', 'V62025']],
    [1.49, null, ['V62050', 'V62025']]
  ]) {
    const low = lowShape(net);
    const layout = TowerSupport.plan(low, loads, shortCatalog.filter(({code}) => code !== excluded), noRegularFrame);
    assert.equal(layout.message, undefined);
    for (const {legCount, frame} of layout.armFrames) {
      const bases = frame.members.filter(member => member.code === 'J60350');
      assert.equal(bases.length, legCount);
      for (const {start: [x, y], end} of bases) {
        assert.deepEqual(end, [x, y, 0.35]);
        const stack = frame.members.filter(member => member.start[0] === x && member.start[1] === y &&
          member.end[0] === x && member.end[1] === y);
        assert.deepEqual(stack.map(member => member.code), ['J60350', ...expected, 'U48601']);
        const jack = stack.at(-1);
        assert.ok(Math.abs(jack.end[2] - net) < 1e-9);
        assert.ok(jack.end[2] - jack.start[2] >= 0.08 && jack.end[2] - jack.start[2] < 0.4);
      }
    }
    const model = TowerSupport.addToModel(TowerFoundation.makeModel(low), layout);
    assert.equal(model.members.filter(({inspection}) => inspection?.category === 'fixedBase').length, layout.legCount);
  }
  for (const height of [0.67, 1.5]) {
    assert.match(TowerSupport.plan(lowShape(height), loads, shortCatalog, noRegularFrame).message,
      /Conventional frame does not fit/);
  }
  const regular = TowerSupport.plan(lowShape(1.45), loads, shortCatalog, buildFrame);
  assert.equal(regular.armFrames.length, 4);
  assert.ok(regular.armFrames.every(({frame}) => !frame.members.some(member => member.code === 'J60350')));
});

function loadFrameCalculator(calculator, manual = false) {
  require('../scaffold-model.js');
  const cut = (from, until) => calculator.slice(calculator.indexOf(from), calculator.indexOf(until));
  return runInThisContext('(function () {' +
    cut('const SPACINGS', '// 表單與結果') + cut('const defaultSizes', 'let refreshTowerSupport') +
    cut('function invalid', 'function readNumber') + cut('function buildTowerFrame', 'function calculateWithBaseAdjustment') +
    (manual ? cut('function calculateWithBaseAdjustment', 'function layoutKey') : '') +
    'return {buildTowerFrame, catalog' + (manual ? ', calculateKeepingMaterials' : '') + '}; })()');
}

test('configures the 1400 mm inner soffit example and keeps regular rows where they connect', () => {
  const {buildTowerFrame, catalog: defaultCatalog} = loadFrameCalculator(calculator);
  const sample = TowerFoundation.calculate({...TowerFoundation.example, clearance: 1400});
  const [sampleWood] = TowerFoundation.woodMaterials;
  const woodStrength = {e: sampleWood.e, fb: sampleWood.fb * 2, fv: sampleWood.fv * 2};
  const sampleBoard = {...TowerFoundation.rectangleSection(1000, 21), ...woodStrength, height: 0.021, shearArea: 140};
  const sampleTimber = {...TowerFoundation.rectangleSection(90, 150), ...woodStrength, height: 0.15, width: 0.09, shearArea: 90};
  const sampleLoads = {...loads, board: sampleBoard, timber: sampleTimber, sideExtension: 0.9, legCapacity: 80.84 / 2.5 / 4};
  const layout = TowerSupport.plan(sample, sampleLoads, defaultCatalog, buildTowerFrame);
  assert.equal(layout.message, undefined);
  assert.equal(layout.armFrames.length, 4);
  assert.ok(layout.armFrames.every(({frame}) => frame.members.some(member => member.code === 'J60350')));

  const raised = TowerFoundation.calculate({...TowerFoundation.example, clearance: 1550});
  const mixed = TowerSupport.plan(raised, sampleLoads, defaultCatalog, buildTowerFrame);
  assert.equal(mixed.message, undefined);
  for (const {frame} of mixed.armFrames) {
    assert.ok(frame.members.some(member => member.code === 'J60350'));
    assert.ok(frame.members.some(member => member.code === 'J48601'));
  }

  const flat = TowerFoundation.calculate({...sample, outerDepth: sample.innerDepth, clearance: 1821});
  const regular = TowerSupport.plan(flat, sampleLoads, defaultCatalog, buildTowerFrame);
  assert.equal(regular.message, undefined);
  assert.equal(regular.armFrames.length, 4);
  for (const {frame, legCount} of regular.armFrames) {
    assert.equal(frame.members.filter(member => member.code === 'J48601').length, legCount);
    assert.ok(!frame.members.some(member => member.code === 'J60350'));
  }
});

test('the Sucoot page respects selected rails, posts, bases and adjustment seats', () => {
  require('../tower-sucoot-material-checks.js');
  const page = readFileSync(join(__dirname, '../ACT20261125sucoot.html'), 'utf8');
  const [, selectedCalculator] = [...page.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match => match[1]);
  const {buildTowerFrame, catalog: defaultCatalog} = loadFrameCalculator(selectedCalculator);
  const options = {...loads, sideExtension: 0.9, materialMethod: globalThis.TowerSucootMaterialChecks};
  const run = (clearance, excluded) => {
    const available = new Set([...defaultCatalog.map(({code}) => code), 'J60350'].filter(code => !excluded.includes(code)));
    return TowerSupport.plan(TowerFoundation.calculate({...TowerFoundation.example, clearance}),
      {...options, allowedPartCodes: available}, defaultCatalog, buildTowerFrame);
  };
  for (const [clearance, excluded, expected] of [
    [5000, [], 'H66240'],
    [5000, ['H66240', 'V60150', 'V61150', 'V62050'], 'V61100'],
    [1400, ['J48601', 'V62020'], 'J60350']
  ]) {
    const layout = run(clearance, excluded);
    assert.equal(layout.message, undefined);
    assert.equal(layout.armFrames.length, 4);
    const used = layout.armFrames.flatMap(({frame}) => frame.members.map(({code}) => code));
    assert.ok(used.includes(expected));
    assert.ok(!used.some(code => excluded.includes(code)));
    if (expected === 'J60350') assert.equal(layout.parts.get(expected).weight, 3.04);
  }
  assert.match(run(5000, ['U48601']).message, /上調整座/);
});

test('the Sucoot parts calculator counts and assembles 3.04 kg fixed bases for short or mixed supports', () => {
  const page = readFileSync(join(__dirname, '../ACT20261125sucoot.html'), 'utf8');
  const [sucootAssembly, selectedCalculator] = [...page.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match => match[1]);
  runInThisContext(sucootAssembly);
  const {calculateKeepingMaterials, catalog: parts} = loadFrameCalculator(selectedCalculator, true);
  const options = {spacingX: 0.9, spacingY: 0.9, lengthX: 2.7, lengthY: 1.8, baseHeight: 0.2, frameHeight: 1.5,
    xGaps: null, yGaps: null, xBraces: null, yBraces: null, minUpperJack: 0.08, useFixedBase: true};
  const calculate = (inner, outer, minUpperJack = 0.08) => calculateKeepingMaterials({
    ...options, h1: inner, h2: outer, h3: inner, h4: outer, minUpperJack
  }).calculation;
  const fixedIndex = parts.findIndex(({code}) => code === 'J60350');
  assert.equal(parts[fixedIndex].weight, 3.04);
  const low = calculate(0.75, 0.75);
  assert.equal(low.quantities[fixedIndex], low.geometry.supports.length);
  assert.equal(low.geometry.fixedBaseCount, low.quantities[fixedIndex]);
  assert.ok(globalThis.ScaffoldACT.build(low.geometry).members.some(member => member.code === 'J60350'));

  const mixed = calculate(0.85, 1.85);
  const {members} = globalThis.ScaffoldACT.build(mixed.geometry);
  assert.ok(members.some(member => member.code === 'J60350'));
  assert.ok(members.some(member => member.code === 'J48601'));
  assert.ok(members.some(member => member.note === '下底座配置的同高圓盤接點。'));
  assert.equal(calculate(2.5, 2.5).quantities[fixedIndex], 0);
  const raisedJack = globalThis.ScaffoldACT.build(calculate(1.02, 1.02, 0.16).geometry);
  assert.ok(raisedJack.members.filter(member => member.code === 'U48601').every(({start, end}) => end[2] - start[2] >= 0.16));
  assert.throws(() => calculate(1, 1, 0.16), /上調整座行程/);

  const adjacent = calculate(0.78, 0.98);
  const adjacentMembers = globalThis.ScaffoldACT.build(adjacent.geometry).members;
  const stations = [...new Set(adjacentMembers.filter(({code}) => code === 'J60350').map(({start}) => start[0]))].sort((a, b) => a - b);
  const [before, converted] = stations.slice(-2);
  assert.ok(!adjacentMembers.some(({code}) => code === 'V62050'));
  const firstY = adjacentMembers.find(({code}) => code === 'J60350').start[1];
  const sleevesAt = x => adjacentMembers.filter(({code, start}) => code === 'V62025' && start[0] === x && start[1] === firstY);
  assert.equal(sleevesAt(before).length, 1);
  assert.equal(sleevesAt(converted).length, 2);
  assert.ok(adjacentMembers.some(({code, start, end}) => code === 'H66090' &&
    start[0] === before && end[0] === converted && start[2] === 0.5 && end[2] === 0.5));
  assert.ok(globalThis.ScaffoldACT.build(calculate(0.98, 0.98).geometry).members.some(({code}) => code === 'V62050'));

  const cross = calculateKeepingMaterials({...options, h1: 0.78, h2: 0.78, h3: 0.98, h4: 0.98}).calculation;
  const crossMembers = globalThis.ScaffoldACT.build(cross.geometry).members;
  const yStations = [...new Set(crossMembers.filter(({code}) => code === 'J60350').map(({start}) => start[1]))].sort((a, b) => a - b);
  const [crossBefore, crossConverted] = yStations.slice(-2);
  assert.ok(!crossMembers.some(({code}) => code === 'V62050'));
  assert.ok(crossMembers.some(({code, start, end}) => code === 'H66060' && start[0] === end[0] &&
    start[1] === crossBefore && end[1] === crossConverted && start[2] === 0.5 && end[2] === 0.5));

  const levelRails = inner => globalThis.ScaffoldACT.build(calculate(inner, 1.24).geometry).members
    .filter(({code}) => code.startsWith('H'));
  assert.deepEqual([...new Set(levelRails(1.24).map(({start}) => start[2]))].sort(), [0.25, 1]);
  assert.ok(levelRails(1.10).some(({start, end}) => start[0] !== end[0] && start[2] === 0.75));
});

test('the tower layout matches adjacent fixed bases at the first short auxiliary ring', () => {
  const shortCatalog = [...catalog, ...['V62025', 'V62050', 'U48601'].map(code => ({code, weight: 1}))];
  const noRegularFrame = () => { throw Object.assign(new Error('Conventional frame does not fit'), {towerFrameFit: true}); };
  const low = TowerFoundation.calculate({...shape, innerDepth: 2100, outerDepth: 1870,
    clearance: (0.76 + board.height + timber.height + steel.height) * 1000});
  const options = {...loads, fixedNeighborRule: true};
  const baseline = TowerSupport.plan(low, loads, shortCatalog, noRegularFrame);
  assert.ok(baseline.armFrames[0].frame.members.some(({code}) => code === 'V62050'));
  const layout = TowerSupport.plan(low, options, shortCatalog, noRegularFrame);
  assert.equal(layout.armFrames.length, 4);
  const {members} = layout.armFrames[0].frame;
  const stations = [...new Set(members.filter(({code}) => code === 'J60350').map(({start}) => start[0]))].sort((a, b) => a - b);
  const [before, converted] = stations.slice(-2);
  const sleevesAt = x => members.filter(({code, start}) => code === 'V62025' && start[0] === x && start[1] === 0);
  assert.equal(sleevesAt(before).length, 1);
  assert.equal(sleevesAt(converted).length, 2);
  assert.ok(members.some(({code, start, end}) => code.startsWith('H') &&
    start[0] === before && end[0] === converted && Math.abs(start[2] - 0.5) < 1e-9 && start[2] === end[2]));

  const flat = TowerFoundation.calculate({...shape, outerDepth: shape.innerDepth,
    clearance: (1.24 + board.height + timber.height + steel.height) * 1000});
  const flatLayout = TowerSupport.plan(flat, options, shortCatalog, noRegularFrame);
  assert.equal(flatLayout.armFrames.length, 4);
  const rails = flatLayout.armFrames[0].frame.members.filter(({code}) => code.startsWith('H'));
  assert.ok(rails.some(({start, end}) => start[0] !== end[0] && Math.abs(start[2] - 1) < 1e-9));
  assert.ok(rails.some(({start, end}) => start[1] !== end[1] && Math.abs(start[2] - 1) < 1e-9));
  assert.ok(!rails.some(({start}) => Math.abs(start[2] - 0.75) < 1e-9));
});

test('the Sucoot assembly uses row directions and turns braces above the lower frame toward the high side', () => {
  const page = readFileSync(join(__dirname, '../ACT20261125sucoot.html'), 'utf8');
  const sucootAssembly = page.match(/<script>([\s\S]*?)<\/script>/)[1];
  runInThisContext(sucootAssembly);
  const links = [false, true].flatMap(alongY => [1, 2].map(row =>
    ({index: 0, count: 2, alongY, row, first: 1, second: 2})));
  const geometry = {catalog: [{code: 'D61515', kind: 'brace', size: 1.5, rise: 1.5}], quantities: [8],
    xGaps: [0, 1.5, 1.5, 0], yGaps: [0, 1.5, 1.5, 0], heights: [
      [], [0, 3, 4], [0, 4, 3]
    ], base: 0.2, supports: [], links};
  for (const uneven of [false, true]) {
    const heights = uneven ? geometry.heights : [[], [0, 4, 4], [0, 4, 4]];
    for (const braceRowOffset of [0, 1]) {
      const {members} = globalThis.ScaffoldACT.build({...geometry, heights, braceRowOffset});
      for (const [i, {alongY, row, count}] of links.entries()) {
        const globalRow = row + (alongY ? braceRowOffset : 0);
        const rowSlope = globalRow % 2 === (alongY ? 1 : 0) ? 1 : -1;
        const braces = members.slice(i * count, (i + 1) * count);
        for (const [level, {start, end, note}] of braces.entries()) {
          const turns = uneven && level === 1;
          const slope = turns ? (row === 1 ? 1 : -1) : rowSlope;
          assert.equal(Math.sign(end[2] - start[2]), slope);
          assert.ok(note.startsWith((alongY ? 'Y 向' : 'X 向') + '第 ' + globalRow + ' 排'));
          assert.equal(note.includes('轉向較高側'), turns);
        }
      }
    }
  }
});
