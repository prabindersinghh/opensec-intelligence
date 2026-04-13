#!/usr/bin/env bash
set -euo pipefail

if [ ! -f promise-pool.js ]; then
  echo "FAIL: promise-pool.js not found"
  exit 1
fi

node -e "
const { promisePool } = require('./promise-pool');

(async () => {
  // Track concurrency
  let running = 0;
  let maxRunning = 0;

  const makeTask = (id, delay) => () => new Promise(resolve => {
    running++;
    if (running > maxRunning) maxRunning = running;
    setTimeout(() => {
      running--;
      resolve('result-' + id);
    }, delay);
  });

  const tasks = [
    makeTask(0, 50),
    makeTask(1, 50),
    makeTask(2, 50),
    makeTask(3, 50),
    makeTask(4, 50),
  ];

  const results = await promisePool(tasks, 2);

  // Check results are in order
  if (!Array.isArray(results) || results.length !== 5) {
    console.log('FAIL: expected 5 results, got', results);
    process.exit(1);
  }

  for (let i = 0; i < 5; i++) {
    if (results[i] !== 'result-' + i) {
      console.log('FAIL: result', i, 'should be result-' + i + ', got', results[i]);
      process.exit(1);
    }
  }

  // Check max concurrency was respected
  if (maxRunning > 2) {
    console.log('FAIL: max concurrent tasks was', maxRunning, 'expected <= 2');
    process.exit(1);
  }

  console.log('PASS');
})();
"
