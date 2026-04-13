#!/usr/bin/env bash
set -euo pipefail

if [ ! -f safe-parse.js ]; then
  echo "FAIL: safe-parse.js not found"
  exit 1
fi

node -e "
const { safeParse } = require('./safe-parse');

// Test valid JSON
const obj = safeParse('{\"a\":1}');
if (!obj || obj.a !== 1) {
  console.log('FAIL: safeParse valid JSON returned', obj);
  process.exit(1);
}

// Test invalid JSON returns null
const bad = safeParse('invalid');
if (bad !== null) {
  console.log('FAIL: safeParse invalid JSON should return null, got', bad);
  process.exit(1);
}

// Test empty string returns null
const empty = safeParse('');
if (empty !== null) {
  console.log('FAIL: safeParse empty string should return null, got', empty);
  process.exit(1);
}

// Test nested object
const nested = safeParse('{\"x\":{\"y\":2}}');
if (!nested || !nested.x || nested.x.y !== 2) {
  console.log('FAIL: safeParse nested JSON returned', nested);
  process.exit(1);
}

console.log('PASS');
"
