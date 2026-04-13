#!/usr/bin/env bash
set -euo pipefail

if [ ! -f range.js ]; then
  echo "FAIL: range.js not found"
  exit 1
fi

node -e "
const { range } = require('./range');

// Test inclusive range
const r1 = range(1, 5);
if (JSON.stringify(r1) !== '[1,2,3,4,5]') {
  console.log('FAIL: range(1,5) returned', JSON.stringify(r1), 'expected [1,2,3,4,5]');
  process.exit(1);
}

// Test single element range
const r2 = range(0, 0);
if (JSON.stringify(r2) !== '[0]') {
  console.log('FAIL: range(0,0) returned', JSON.stringify(r2), 'expected [0]');
  process.exit(1);
}

// Test range starting from negative
const r3 = range(-2, 2);
if (JSON.stringify(r3) !== '[-2,-1,0,1,2]') {
  console.log('FAIL: range(-2,2) returned', JSON.stringify(r3), 'expected [-2,-1,0,1,2]');
  process.exit(1);
}

console.log('PASS');
"
