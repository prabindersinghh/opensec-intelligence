#!/bin/bash
set -euo pipefail

node -e "
const mod = require('./observable.js');
// Flexible import: support { Observable } or default export
const Observable = mod.Observable || (typeof mod === 'function' ? mod : mod.default);
if (!Observable || typeof Observable.of !== 'function') { console.error('Cannot find Observable.of'); process.exit(1); }

// Also flexibly find operators
const mapOp = mod.map;
const filterOp = mod.filter;
const takeOp = mod.take;

// Test Observable.of
const values1 = [];
const obs = Observable.of(1, 2, 3, 4, 5);
const unsub = obs.subscribe({ next: v => values1.push(v) });
if (values1.length !== 5) {
  console.error('of() should emit 5 values, got', values1.length);
  process.exit(1);
}
for (let i = 0; i < 5; i++) {
  if (values1[i] !== i + 1) {
    console.error('of() value mismatch at index', i, ':', values1[i]);
    process.exit(1);
  }
}

// Test unsubscribe is a function
if (typeof unsub !== 'function') {
  console.error('subscribe should return unsubscribe function');
  process.exit(1);
}

// Test map operator — accept curried or direct style
if (typeof mapOp !== 'function') { console.error('map not exported'); process.exit(1); }
const values2 = [];
const mapResult = mapOp(x => x * 2);
let obs2;
if (typeof mapResult === 'function') {
  obs2 = mapResult(Observable.of(1, 2, 3));
} else if (mapResult && typeof mapResult.subscribe === 'function') {
  obs2 = mapResult;
} else {
  console.error('map operator returned unexpected type'); process.exit(1);
}
obs2.subscribe({ next: v => values2.push(v) });
if (values2.length !== 3 || values2[0] !== 2 || values2[1] !== 4 || values2[2] !== 6) {
  console.error('map failed:', values2);
  process.exit(1);
}

// Test filter operator
if (typeof filterOp !== 'function') { console.error('filter not exported'); process.exit(1); }
const values3 = [];
const filterResult = filterOp(x => x > 2);
const obs3 = typeof filterResult === 'function' ? filterResult(Observable.of(1, 2, 3, 4)) : filterResult;
obs3.subscribe({ next: v => values3.push(v) });
if (values3.length !== 2 || values3[0] !== 3 || values3[1] !== 4) {
  console.error('filter failed:', values3);
  process.exit(1);
}

// Test take operator
if (typeof takeOp !== 'function') { console.error('take not exported'); process.exit(1); }
const values4 = [];
const takeResult = takeOp(2);
const obs4 = typeof takeResult === 'function' ? takeResult(Observable.of(1, 2, 3, 4, 5)) : takeResult;
obs4.subscribe({ next: v => values4.push(v) });
if (values4.length !== 2 || values4[0] !== 1 || values4[1] !== 2) {
  console.error('take failed:', values4);
  process.exit(1);
}

console.log('All observable tests passed');
"
