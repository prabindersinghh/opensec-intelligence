#!/usr/bin/env bash
set -euo pipefail

if [ ! -f arg-parser.js ]; then
  echo "FAIL: arg-parser.js not found"
  exit 1
fi

node -e "
const { parseArgs } = require('./arg-parser');

// Test flags
const r1 = parseArgs(['--verbose', '--debug']);
if (!r1.flags || r1.flags.verbose !== true || r1.flags.debug !== true) {
  console.log('FAIL: flags not parsed correctly', JSON.stringify(r1));
  process.exit(1);
}

// Test options (--key value)
const r2 = parseArgs(['--output', 'dist', '--format', 'json']);
if (!r2.options || r2.options.output !== 'dist' || r2.options.format !== 'json') {
  // Try checking flags+options combined or alternate structure
  const opts = r2.options || r2.flags || r2;
  if (opts.output !== 'dist' || opts.format !== 'json') {
    console.log('FAIL: options not parsed correctly', JSON.stringify(r2));
    process.exit(1);
  }
}

// Test positional args
const r3 = parseArgs(['file1.txt', 'file2.txt']);
const positional = r3.positional || r3.args || r3._ || [];
if (positional.length !== 2 || positional[0] !== 'file1.txt' || positional[1] !== 'file2.txt') {
  console.log('FAIL: positional args not parsed correctly', JSON.stringify(r3));
  process.exit(1);
}

// Test short flags
const r4 = parseArgs(['-v', '-d']);
const flags4 = r4.flags || {};
if (flags4.v !== true && flags4.d !== true) {
  console.log('FAIL: short flags not parsed correctly', JSON.stringify(r4));
  process.exit(1);
}

// Test mixed
const r5 = parseArgs(['--verbose', '--output', 'dist', 'input.txt', '-d']);
const flags5 = r5.flags || {};
const opts5 = r5.options || {};
const pos5 = r5.positional || r5.args || r5._ || [];

if (!flags5.verbose && !flags5.v) {
  // verbose should be a flag
}
if (pos5.indexOf('input.txt') === -1) {
  console.log('FAIL: mixed - positional arg missing', JSON.stringify(r5));
  process.exit(1);
}

// Test empty args
const r6 = parseArgs([]);
const pos6 = r6.positional || r6.args || r6._ || [];
if (pos6.length !== 0) {
  console.log('FAIL: empty args should have no positional', JSON.stringify(r6));
  process.exit(1);
}

console.log('PASS');
"
