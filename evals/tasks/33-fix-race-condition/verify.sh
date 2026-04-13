#!/usr/bin/env bash
set -euo pipefail

# Verifier sets cwd to workspace; WORKSPACE env var also available

node -e "
const { incrementAll, getCount, reset } = require('./counter.js');

async function test() {
  // Run multiple times to catch flaky race conditions
  for (let trial = 0; trial < 5; trial++) {
    reset();
    await incrementAll(10);
    const result = getCount();
    if (result !== 10) {
      console.error('Trial ' + trial + ': Expected count=10, got ' + result);
      process.exit(1);
    }
  }
  // Test with larger number
  reset();
  await incrementAll(50);
  const result = getCount();
  if (result !== 50) {
    console.error('Expected count=50, got ' + result);
    process.exit(1);
  }
  console.log('All race condition tests passed');
}

test().catch(e => { console.error(e); process.exit(1); });
"
