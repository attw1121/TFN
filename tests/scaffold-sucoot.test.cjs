const assert = require('node:assert/strict');
const {test} = require('node:test');

require('../scaffold-sucoot.js');
require('../scaffold-model.js');
const {specs, mesh, previewCSV} = globalThis.ScaffoldSucoot;
const {COLORS, parseCSV} = globalThis.ScaffoldModel;

test('the catalog covers every calculator code and exposes the additional catalog sizes', () => {
  assert.ok(Object.keys(COLORS).every(code => specs[code]));
  const {members} = parseCSV(previewCSV());
  assert.equal(members.length, 40);
  const find = code => members.find(member => member.code === code);
  assert.equal(find('V60200').end[2], 2);
  assert.deepEqual(specs.D61210.span, [1.2, 0, 1]);
  assert.deepEqual(specs.D61215.span, [1.2, 0, 1.5]);
  assert.deepEqual(specs.LOC_240_150.span, [2.4, 1.5, 0]);
  for (const code of ['J63601', 'U63601', 'U63601S']) assert.ok(find(code), code);
});

test('meshes use dimensions and connection offsets from the detail drawing', () => {
  function points(code, length, options) {
    const vertices = [];
    mesh(code, length, vertex => vertices.push(vertex), options);
    return vertices;
  }
  const near = (actual, expected) => Math.abs(actual - expected) < 1e-9;
  for (const [code, length, discUpperEdge, collarEnd] of [
    ['V62020', 0.2, 0.105, 0.29],
    ['V62025', 0.25, 0.155, -0.06],
    ['V62050', 0.5, 0.405, -0.06]
  ]) {
    const vertices = points(code, length, {detailed: false});
    assert.ok(vertices.some(([x, y, z]) => near(Math.hypot(x, y), 0.067) && near(z, discUpperEdge)), code);
    assert.ok(vertices.some(([x, y, z]) => near(Math.hypot(x, y), 0.0351) && near(z, collarEnd)), code);
  }
  const post = points('V61150', 1.5);
  assert.ok(post.some(([x, y, z]) => near(x, 0.020) && near(y, 0.020) && near(z, -0.150)));
  const saddle = points('U63601', 0.25, {specimen: true});
  assert.ok(saddle.some(([x, y, z]) => near(Math.abs(x), 0.085) && near(Math.abs(y), 0.075) && near(z, 0.294)));
  const rail = points('H66150', 1.5);
  assert.ok(rail.some(([x, y]) => near(Math.abs(x), 0.003) && near(Math.abs(y), 0.070)));
});

test('every catalog size produces finite triangles at both detail levels', () => {
  for (const [code, {span}] of Object.entries(specs)) {
    for (const detailed of [true, false]) {
      let count = 0;
      assert.equal(mesh(code, Math.hypot(...span), (point, normal) => {
        assert.ok(point.every(Number.isFinite), code);
        assert.ok(Math.abs(Math.hypot(...normal) - 1) < 1e-8, code);
        count++;
      }, {detailed, specimen: true}), true);
      assert.ok(count > 0 && count % 3 === 0, code);
    }
  }
  assert.equal(mesh('CUSTOM', 1, () => assert.fail('Unknown models use the viewer fallback')), false);
});

test('the DXF foot mesh uses the measured plate, ring and overall height', () => {
  const vertices = [];
  assert.equal(mesh('J60350', 0.35, vertex => vertices.push(vertex), {detailed: false}), true);
  assert.equal(Math.min(...vertices.map(([, , z]) => z)), 0);
  assert.equal(Math.max(...vertices.map(([, , z]) => z)), 0.35);
  assert.ok(vertices.some(([x, y, z]) => x === 0.07 && y === 0.07 && z === 0.006));
  for (const height of [0.245, 0.255]) {
    assert.ok(vertices.some(([x, y, z]) => Math.abs(Math.hypot(x, y) - 0.067) < 1e-9 && z === height));
  }
});
