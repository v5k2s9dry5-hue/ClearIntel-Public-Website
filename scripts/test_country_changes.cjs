'use strict';
// Pure change-detection smoke checks without a DOM or network connection.
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const code = fs.readFileSync('assets/app.js', 'utf8');
const start = code.indexOf('const countrySnapshots = new Map();');
const end = code.indexOf('// Contextual help', start);
assert.ok(start >= 0 && end > start, 'Country feed change detection is present');
const sandbox = {window: {}, Map};
vm.runInNewContext(code.slice(start, end), sandbox);
const detect = sandbox.window.ClearIntelCountryChanges;
const story = (url, title='Council update', sources=[url]) => ({
  basis:'recent', reports:sources.map((address,index) => ({
    url:address, title:index?title+' also reported':title,
  }))
});
const result = stories => ({stories});
let change = detect('GB', result([story('https://one.example/1')]));
assert.equal(change.initial, true, 'First fetch establishes baseline');
assert.equal(change.newCount, 0);
change = detect('GB', result([story('https://one.example/1')]));
assert.equal(change.newCount, 0, 'Rechecking cached feed is not a new event');
change = detect('GB', result([story('https://one.example/1', 'Updated council statement')]));
assert.equal(change.updatedCount, 1, 'Changed headline under same URL');
change = detect('GB', result([story('https://two.example/2')]));
assert.equal(change.newCount, 1, 'New article in the feed');
change = detect('ES', result([story('https://other.example/3')]));
assert.equal(change.initial, true, 'Country baselines remain separate');
console.log('Country feed change detection: all checks passed');
