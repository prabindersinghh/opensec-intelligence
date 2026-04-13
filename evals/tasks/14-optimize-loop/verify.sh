#!/bin/bash
node -e "
const { findDuplicates } = require('./duplicates.js');

// Correctness
const r1 = findDuplicates([1, 2, 3, 2, 4, 3]);
if (!r1.includes(2) || !r1.includes(3) || r1.length !== 2) process.exit(1);

const r2 = findDuplicates([1, 2, 3]);
if (r2.length !== 0) process.exit(1);

// Check it uses Set or Map (not nested loops)
const src = require('fs').readFileSync('./duplicates.js', 'utf-8');
if (src.includes('for') && src.match(/for/g).length > 1) {
  // Still has nested loops
  process.exit(1);
}
"
