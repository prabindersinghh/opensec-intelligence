#!/bin/bash
set -euo pipefail

node -e "
const { calculate } = require('./calculator.js');

// Check no eval usage
const src = require('fs').readFileSync('./calculator.js', 'utf-8');
if (src.includes('eval(') || src.includes('Function(')) {
  console.error('Must not use eval() or Function()');
  process.exit(1);
}

// Basic
if (calculate('2+3') !== 5) process.exit(1);
if (calculate('10-4') !== 6) process.exit(1);

// Precedence
if (calculate('2+3*4') !== 14) process.exit(1);
if (calculate('10-2*3') !== 4) process.exit(1);

// Parentheses
if (calculate('(2+3)*4') !== 20) process.exit(1);
if (calculate('10/(2+3)') !== 2) process.exit(1);

// Negative numbers
if (calculate('-5+3') !== -2) process.exit(1);

// Division
if (calculate('10/3') !== 10/3) {
  // Allow some floating point tolerance
  if (Math.abs(calculate('10/3') - 10/3) > 0.0001) process.exit(1);
}
"
