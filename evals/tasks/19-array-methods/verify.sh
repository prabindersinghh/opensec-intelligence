#!/usr/bin/env bash
set -euo pipefail

if [ ! -f array-utils.js ]; then
  echo "FAIL: array-utils.js not found"
  exit 1
fi

node -e "
const { unique, flatten, chunk } = require('./array-utils');

// Test unique
const u = unique([1, 2, 2, 3]);
if (JSON.stringify(u) !== '[1,2,3]') {
  console.log('FAIL: unique([1,2,2,3]) returned', JSON.stringify(u));
  process.exit(1);
}

// Test unique with strings
const us = unique(['a', 'b', 'a']);
if (JSON.stringify(us) !== '[\"a\",\"b\"]') {
  console.log('FAIL: unique strings returned', JSON.stringify(us));
  process.exit(1);
}

// Test flatten
const f = flatten([[1, 2], [3]]);
if (JSON.stringify(f) !== '[1,2,3]') {
  console.log('FAIL: flatten([[1,2],[3]]) returned', JSON.stringify(f));
  process.exit(1);
}

// Test flatten only one level
const f2 = flatten([[1, [2]], [3]]);
if (JSON.stringify(f2) !== '[1,[2],3]') {
  console.log('FAIL: flatten one level returned', JSON.stringify(f2));
  process.exit(1);
}

// Test chunk
const c = chunk([1, 2, 3, 4, 5], 2);
if (JSON.stringify(c) !== '[[1,2],[3,4],[5]]') {
  console.log('FAIL: chunk([1,2,3,4,5],2) returned', JSON.stringify(c));
  process.exit(1);
}

// Test chunk with exact division
const c2 = chunk([1, 2, 3, 4], 2);
if (JSON.stringify(c2) !== '[[1,2],[3,4]]') {
  console.log('FAIL: chunk exact division returned', JSON.stringify(c2));
  process.exit(1);
}

console.log('PASS');
"
