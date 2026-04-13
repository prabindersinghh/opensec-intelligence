#!/bin/bash
set -euo pipefail

node -e "
const path = require('path');
const mod = require('./worker-pool.js');
const WorkerPool = typeof mod === 'function' ? mod : (mod.WorkerPool || mod.default);
if (!WorkerPool) { console.error('Could not find WorkerPool export'); process.exit(1); }

async function test() {
  const pool = new WorkerPool(path.join(__dirname, 'worker.js'), 2);

  // Test factorial computations
  const r1 = await pool.exec(5);
  if (r1 !== 120) { console.error('5! should be 120, got', r1); process.exit(1); }

  const r2 = await pool.exec(6);
  if (r2 !== 720) { console.error('6! should be 720, got', r2); process.exit(1); }

  // Test parallel execution
  const results = await Promise.all([
    pool.exec(7),   // 5040
    pool.exec(8),   // 40320
    pool.exec(10),  // 3628800
  ]);
  if (results[0] !== 5040 || results[1] !== 40320 || results[2] !== 3628800) {
    console.error('Parallel results wrong:', results);
    process.exit(1);
  }

  // Test drain
  pool.exec(3); // fire and forget
  pool.exec(4);
  await pool.drain();

  // Test destroy
  await pool.destroy();
}

test().catch(e => { console.error(e); process.exit(1); });
"
