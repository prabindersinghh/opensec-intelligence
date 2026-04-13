#!/usr/bin/env bash
set -euo pipefail

# Verifier sets cwd to workspace; WORKSPACE env var also available

node -e "
const mod = require('./stream-processor.js');
const processLines = typeof mod === 'function' ? mod : (mod.processLines || mod.default);
const path = require('path');
const fs = require('fs');

const inputPath = path.join(__dirname, 'input.txt');
const outputPath = path.join(__dirname, 'output.txt');

// Clean up any previous output
if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);

const inputLines = fs.readFileSync(inputPath, 'utf-8').trim().split('\n');
const lineCount = inputLines.length;

async function test() {
  const count = await processLines(inputPath, outputPath, line => line.toUpperCase());

  // Check line count matches input
  if (count !== lineCount) {
    console.error('Expected ' + lineCount + ' lines processed, got ' + count);
    process.exit(1);
  }

  if (!fs.existsSync(outputPath)) {
    console.error('Output file was not created');
    process.exit(1);
  }

  const output = fs.readFileSync(outputPath, 'utf-8').trim().split('\n');

  if (output.length !== lineCount) {
    console.error('Expected ' + lineCount + ' output lines, got ' + output.length);
    process.exit(1);
  }

  // Each output line should be the uppercase version of the corresponding input line
  for (let i = 0; i < lineCount; i++) {
    if (output[i].trim() !== inputLines[i].toUpperCase()) {
      console.error('Line ' + i + ': expected \"' + inputLines[i].toUpperCase() + '\", got \"' + output[i].trim() + '\"');
      process.exit(1);
    }
  }

  console.log('All stream processor tests passed');
}

test().catch(e => { console.error(e); process.exit(1); });
"

# Clean up output file
rm -f "$(dirname "$0")/workspace/output.txt"
