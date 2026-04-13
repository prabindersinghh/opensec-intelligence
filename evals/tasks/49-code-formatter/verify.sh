#!/bin/bash
set -euo pipefail

node -e "
const { format } = require('./formatter.js');
const fs = require('fs');

const messy = fs.readFileSync('./messy.js', 'utf-8');
const result = format(messy);

// Should end with newline
if (!result.endsWith('\n')) {
  console.error('Should end with newline');
  process.exit(1);
}

// No trailing whitespace on any line
const lines = result.split('\n');
for (let i = 0; i < lines.length; i++) {
  if (lines[i] !== lines[i].trimEnd()) {
    console.error('Trailing whitespace on line', i + 1);
    process.exit(1);
  }
}

// Indentation should be even (multiples of 2 spaces, no tabs)
for (const line of lines) {
  if (line.trim() === '') continue;
  if (line.includes('\t')) {
    console.error('Contains tabs:', line);
    process.exit(1);
  }
  const indent = line.match(/^( *)/)[1].length;
  if (indent % 2 !== 0) {
    console.error('Odd indentation:', indent, 'on line:', line);
    process.exit(1);
  }
}

// Assignment operators should have spaces: check that no identifier=value pattern exists 
// (but allow ===, !==, >=, <=)
const codeLines = result.split('\n').filter(l => l.trim() !== '');
for (const line of codeLines) {
  // Strip out ===, !==, >=, <= first, then check for bare =
  const stripped = line.replace(/[!=><]==/g, '').replace(/[><=]=/g, '');
  if (/\w=\S/.test(stripped) || /\S=\w/.test(stripped)) {
    console.error('Missing spaces around = operator:', line);
    process.exit(1);
  }
}

// Opening braces should be on same line (not alone on a line)
const braceLines = result.split('\n').filter(l => l.trim() === '{');
if (braceLines.length > 0) {
  console.error('Opening brace on own line');
  process.exit(1);
}

console.log('All formatter tests passed');
"
