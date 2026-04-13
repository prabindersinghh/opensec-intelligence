#!/bin/bash
set -euo pipefail

node -e "
const { diff, formatDiff } = require('./diff.js');

// Test basic diff
const old = 'a\nb\nc';
const newer = 'a\nc\nd';
const changes = diff(old, newer);

// Should have entries
if (!Array.isArray(changes) || changes.length === 0) {
  console.error('diff returned empty');
  process.exit(1);
}

// Check types are valid
for (const c of changes) {
  if (!['add', 'remove', 'equal'].includes(c.type)) {
    console.error('Invalid type:', c.type);
    process.exit(1);
  }
}

// 'a' should be equal, 'b' removed, 'c' equal, 'd' added
const equal = changes.filter(c => c.type === 'equal');
const removed = changes.filter(c => c.type === 'remove');
const added = changes.filter(c => c.type === 'add');

if (equal.length < 1) { console.error('Should have equal entries'); process.exit(1); }
if (removed.length < 1) { console.error('Should have remove entries'); process.exit(1); }
if (added.length < 1) { console.error('Should have add entries'); process.exit(1); }

// Test formatDiff
const formatted = formatDiff(changes);
if (typeof formatted !== 'string') { console.error('formatDiff should return string'); process.exit(1); }
// Should contain + and - prefixes
if (!formatted.includes('+') && !formatted.includes('-')) {
  console.error('formatDiff missing +/- prefixes');
  process.exit(1);
}

// Test identical strings
const same = diff('hello\nworld', 'hello\nworld');
if (same.some(c => c.type !== 'equal')) {
  console.error('Identical strings should all be equal');
  process.exit(1);
}
"
