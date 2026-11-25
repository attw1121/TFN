'use strict';
// Run with: node --test tests/material-weights.test.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const context = {};
context.window = context;
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'material-weights.js'), 'utf8'), context);
const api = context.MaterialWeights;
assert.ok(api, 'Shared material-weight API must be exposed');

const flatQuantities = [0,0,25,0,0,25,0,25,25,25,0,40,120,0,0,0,0,60,0,0];
const catalog = () => Array.from(api.defaults, ({code, weight}) => ({code, weight}));
const plain = value => JSON.parse(JSON.stringify(value));

test('default weights preserve the existing 1917.95 kg material calculation', () => {
  assert.equal(api.defaults.length, 20);
  assert.equal(new Set(Array.from(api.defaults, item => item.code)).size, 20);
  const weights = api.calculateTotals(flatQuantities, catalog());
  assert.equal(weights.total, 191795);
  assert.equal(api.formatWeight(weights.total), '1917.95');
  assert.equal(weights.subtotals[2], 43500);
});

test('editing V60300 weight updates totals without changing material quantities or defaults', () => {
  const entries = catalog();
  entries.find(item => item.code === 'V60300').weight = 20;
  const quantities = flatQuantities.slice();
  const before = quantities.slice();
  const weights = api.calculateTotals(quantities, entries);
  assert.equal(weights.total, 198295);
  assert.equal(weights.subtotals[2], 50000);
  assert.deepEqual(quantities, before);
  assert.equal(api.defaults.find(item => item.code === 'V60300').weight, 17.4);
});

test('catalog order is normalized by material code without mutating caller data', () => {
  const entries = catalog().reverse();
  const before = plain(entries);
  const validated = api.validateEntries(entries);
  assert.deepEqual(Array.from(validated, item => item.code), Array.from(api.defaults, item => item.code));
  assert.equal(api.calculateTotals(flatQuantities, entries).total, 191795);
  assert.deepEqual(entries, before);
  validated[0].weight = 99;
  assert.equal(entries.find(item => item.code === validated[0].code).weight, 5.75);
});

test('default catalog and each built-in record are immutable', () => {
  assert.ok(Object.isFrozen(api.defaults));
  assert.ok(Array.from(api.defaults).every(Object.isFrozen));
  assert.throws(() => { api.defaults[0].weight = 99; }, {name: 'TypeError'});
  assert.throws(() => { api.defaults.push({code: 'X', weight: 1}); }, {name: 'TypeError'});
});

test('missing, duplicate, unknown and sparse material entries cannot form a valid catalog', () => {
  assert.throws(() => api.validateEntries(catalog().slice(1)));
  const duplicate = catalog(); duplicate[1].code = duplicate[0].code;
  assert.throws(() => api.validateEntries(duplicate));
  const unknown = catalog(); unknown[1].code = 'UNKNOWN';
  assert.throws(() => api.validateEntries(unknown));
  assert.throws(() => api.validateEntries([...catalog(), {code: 'EXTRA', weight: 1}]));
  assert.throws(() => api.validateEntries(new Array(20)));
  for (const invalid of [null, {}, 'invalid']) assert.throws(() => api.validateEntries(invalid));
});

test('unit weights must be finite positive numbers with at most two decimal places', () => {
  for (const weight of [0, -1, NaN, Infinity, 1.234, '5.75', null, Number.MAX_VALUE]) {
    const entries = catalog(); entries[0].weight = weight;
    assert.throws(() => api.validateEntries(entries), undefined, String(weight));
  }
  for (const weight of [0.01, 0.1, 1.01, 1.23, 7.32, 20]) {
    const entries = catalog(); entries[0].weight = weight;
    assert.equal(api.validateEntries(entries)[0].weight, weight);
  }
});

test('decimal unit weights produce exact hundredths of a kilogram', () => {
  const entries = catalog();
  entries[0].weight = 1.01;
  const quantities = Array(20).fill(0); quantities[0] = 3;
  assert.equal(api.calculateTotals(quantities, entries).total, 303);
  entries[0].weight = 0.01; quantities[0] = 7;
  assert.equal(api.calculateTotals(quantities, entries).total, 7);
  assert.equal(api.formatWeight(7), '0.07');
});

test('all material types and zero quantities are included in weight calculations', () => {
  assert.equal(api.calculateTotals(Array(20).fill(0), catalog()).total, 0);
  assert.equal(api.calculateTotals(Array(20).fill(1), catalog()).total, 12447);
  const quantities = Array(20).fill(0); quantities[19] = 3;
  assert.equal(api.calculateTotals(quantities, catalog()).total, 2598);
});

test('invalid quantities and loss of integer precision are rejected', () => {
  for (const value of [-1, 0.1, NaN, Infinity, '1', null, Number.MAX_SAFE_INTEGER]) {
    const quantities = Array(20).fill(0); quantities[0] = value;
    assert.throws(() => api.calculateTotals(quantities, catalog()), undefined, String(value));
  }
  for (const count of [0,19,21]) assert.throws(() => api.calculateTotals(Array(count).fill(0), catalog()));
  assert.throws(() => api.calculateTotals(new Array(20), catalog()));
  assert.throws(() => api.calculateTotals(Array(20).fill(1000000000000), catalog()));
});

test('weight display retains two decimal places', () => {
  for (const [cents, display] of [[0,'0.00'], [5,'0.05'], [100,'1.00'], [12447,'124.47']]) {
    assert.equal(api.formatWeight(cents), display);
  }
});

test('JSON backup round-trip preserves edited weights by code', () => {
  const entries = catalog(); entries[2].weight = 20;
  const backup = api.makeBackup(entries);
  const restored = api.parseBackup(JSON.parse(JSON.stringify(backup)));
  assert.deepEqual(Array.from(restored, ({code, weight}) => ({code, weight})), entries);
  restored[2].weight = 30;
  assert.equal(entries[2].weight, 20);
});

test('incompatible or incomplete backups are rejected without changing valid data', () => {
  const backup = plain(api.makeBackup(catalog()));
  for (const value of [null, {}, {...backup, version: 999}, {...backup, format: 'other-tool'}]) {
    assert.throws(() => api.parseBackup(value));
  }
  const key = Object.keys(backup).find(key => Array.isArray(backup[key]));
  assert.ok(key, 'Backup contains an explicit material catalog');
  for (const change of [
    entries => entries.pop(),
    entries => { entries[1].code = entries[0].code; },
    entries => { entries[0].weight = -1; }
  ]) {
    const invalid = plain(backup); change(invalid[key]);
    assert.throws(() => api.parseBackup(invalid));
  }
  assert.equal(api.calculateTotals(flatQuantities, api.parseBackup(backup)).total, 191795);
});
