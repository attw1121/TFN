const assert = require('node:assert/strict');
const {test} = require('node:test');
require('../tower-foundation.js');
require('../tower-dxf-blocks.js');
require('../tower-dxf-template.js');
require('../tower-dxf.js');

const {TowerFoundation, TowerDxf} = globalThis;
const shape = TowerFoundation.calculate(TowerFoundation.example);

function entities(source) {
  const tags = source.trimEnd().split('\r\n');
  const result = [];
  for (let i = 0; i < tags.length; i += 2) {
    const code = Number(tags[i]), value = tags[i + 1];
    if (code === 0) result.push({type: value, fields: []});
    else result.at(-1).fields.push([code, value]);
  }
  return result;
}

const field = (entity, code) => entity.fields.find(([key]) => key === code)?.[1];
const insertPoint = entity => [Number(field(entity, 10)), Number(field(entity, 20))];

test('DXF exports millimetre geometry, annotated views and editable CAD library inserts', () => {
  const points = [0.2, 1.1, 2];
  const member = (code, start, end) => ({code, start, end});
  const frameAlong = {positions: points, gaps: [0.9, 0.9]};
  const frameAcross = {positions: points, gaps: [0.9, 0.9]};
  const frame = {members: [
    member('J60350', [0, 0, 0], [0, 0, 0.35]),
    member('V62025', [0, 0, 0.35], [0, 0, 0.6]),
    member('U48601', [0, 0, 0.6], [0, 0, 0.75]),
    member('J60350', [0.9, 0, 0], [0.9, 0, 0.35]),
    member('V62025', [0.9, 0, 0.35], [0.9, 0, 0.6]),
    member('H66090', [0, 0, 0.25], [0.9, 0, 0.25]),
    member('D60915', [0, 0, 2], [0.9, 0, 0.5]),
    member('D60915', [0, 0, 2.5], [0, 0.9, 4]),
    member('D60915', [0, 0, 4.5], [0.9, 0, 6]),
    member('D60915', [0, 0.9, 2], [0.9, 0.9, 0.5]),
    member('D60915', [0, 1.8, 2], [0.9, 1.8, 0.5]),
    member('D60915', [1.8, 0, 2.5], [1.8, 0.9, 4]),
    member('H66090', [0, 0, 0.25], [0, 0.9, 0.25])
  ]};
  const parts = new Map([
    ['H66090', {kind: 'rail', size: 0.9}],
    ['D60915', {kind: 'brace', size: 0.9, rise: 1.5}]
  ]);
  const layout = {armFrames: [{arm: 'a', frameAlong, frameAcross, frame}], parts, totalLength: 6.325,
    soffit: () => 5, board: {height: 0.021}, timber: {height: 0.15}, steel: {height: 0.2}};
  const groundProfiles = {a: {origin: 0, points: [[1000, 0], [1000, -250]]}};
  const {content, schematicParts} = TowerDxf.exportDrawing({shape, layout, endExtension: 0.6, sideExtension: 0.9, groundProfiles});
  assert.deepEqual(schematicParts, []);
  assert.match(content, /\$INSUNITS\r\n70\r\n4\r\n/);
  const drawing = entities(content);
  assert.ok(drawing.some(e => e.type === 'APPID' && field(e, 2) === 'ACAD'));
  assert.ok(drawing.some(e => e.type === 'SECTION' && field(e, 2) === 'OBJECTS'));
  const model = drawing.find(e => e.type === 'BLOCK_RECORD' && field(e, 2) === '*Model_Space');
  assert.ok(drawing.some(e => e.type === 'LAYOUT' && field(e, 5) === field(model, 340)));
  const texts = drawing.filter(e => e.type === 'TEXT').map(e => field(e, 1));
  for (const label of ['電塔基座支撐平面圖（mm）', 'A–C 剖面圖（mm）', 'B–D 剖面圖（mm）', '1000: 0 → -250', 'X', 'Y', 'J60350', 'V62025', 'U48601']) {
    assert.ok(texts.includes(label));
  }
  const inserts = drawing.filter(e => e.type === 'INSERT');
  assert.ok(inserts.every(e => field(e, 330) === field(model, 5)));
  for (const block of ['P_RING', 'P_H66090', 'P_D60915', 'E_J60350', 'E_V62025', 'E_H66090', 'E_D60915']) {
    assert.ok(drawing.some(e => e.type === 'BLOCK' && field(e, 2) === block));
    assert.ok(inserts.some(e => field(e, 2) === block));
  }
  const insert = name => inserts.find(e => field(e, 2) === name);
  const planDiscs = inserts.filter(e => field(e, 2) === 'P_RING').map(insertPoint);
  assert.deepEqual(insertPoint(insert('P_H66090')), planDiscs[0]);
  assert.deepEqual(insertPoint(insert('P_D60915')), planDiscs[3]);
  const planBraces = inserts.filter(e => field(e, 2) === 'P_D60915');
  assert.equal(planBraces.length, 5);
  assert.deepEqual(planBraces.map(e => Number(field(e, 42))), [1, 1, -1, -1, -1]);
  assert.deepEqual(insertPoint(planBraces[1]), planDiscs[0]);
  assert.equal(texts.filter(label => label === 'H66090').length, 3);
  assert.equal(texts.filter(label => label === 'D60915').length, 7);
  const [railBase, braceBase] = inserts.filter(e => field(e, 2) === 'E_J60350').map(insertPoint);
  assert.deepEqual(insertPoint(insert('E_H66090')), [railBase[0], railBase[1] + 250]);
  const brace = insert('E_D60915');
  assert.deepEqual(insertPoint(brace), [braceBase[0], braceBase[1] + 500]);
  assert.equal(Number(field(brace, 41)), 1);
  assert.equal(Number(field(brace, 42)), 1);
  for (const [name, offset] of [['E_H66090', 12.7234], ['E_D60915', 4.9001], ['P_H66090', 0], ['P_D60915', 0]]) {
    const record = drawing.find(e => e.type === 'BLOCK_RECORD' && field(e, 2) === name);
    const line = drawing.find(e => e.type === 'LINE' && field(e, 330) === field(record, 5));
    const [, x1, y1, x2, y2] = globalThis.TowerDxfBlocks[name].find(([type]) => type === 'L');
    assert.deepEqual([10, 20, 11, 21].map(code => Number(field(line, code))),
      [x1, y1 + offset, x2, y2 + offset].map(value => Number(value.toFixed(4))));
  }
  const ground = drawing.find(e => e.type === 'LWPOLYLINE' && field(e, 8) === 'GROUND' && field(e, 90) === '4');
  assert.ok(ground);
  const xs = ground.fields.filter(([key]) => key === 10).map(([, value]) => value);
  assert.equal(xs[1], xs[2]);
  assert.equal(drawing.at(-1).type, 'EOF');
});

test('DXF also exports unconfigured beam dimensions without inventing scaffold members', () => {
  const {content, schematicParts} = TowerDxf.exportDrawing({shape, layout: {message: '未配置'}});
  assert.deepEqual(schematicParts, []);
  assert.match(content, /目前未配置支撐架/);
  assert.ok(!entities(content).some(e => e.type === 'INSERT'));
});
