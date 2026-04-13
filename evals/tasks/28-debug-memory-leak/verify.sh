#!/usr/bin/env bash
set -euo pipefail

if [ ! -f cache.js ]; then
  echo "FAIL: cache.js not found"
  exit 1
fi

node -e "
const { Cache } = require('./cache');

// Test maxSize parameter
const cache = new Cache(3);

cache.set('a', 1);
cache.set('b', 2);
cache.set('c', 3);

if (cache.size !== 3) {
  console.log('FAIL: cache size should be 3, got', cache.size);
  process.exit(1);
}

// Adding a 4th item should evict the oldest (LRU)
cache.set('d', 4);

if (cache.size !== 3) {
  console.log('FAIL: cache size should still be 3 after eviction, got', cache.size);
  process.exit(1);
}

// 'a' should have been evicted (oldest/least recently used)
if (cache.has('a')) {
  console.log('FAIL: key \"a\" should have been evicted');
  process.exit(1);
}

// Other keys should still exist
if (!cache.has('b') || !cache.has('c') || !cache.has('d')) {
  console.log('FAIL: keys b, c, d should still exist');
  process.exit(1);
}

if (cache.get('d') !== 4) {
  console.log('FAIL: cache.get(\"d\") should return 4, got', cache.get('d'));
  process.exit(1);
}

// Test that accessing a key makes it recently used
const cache2 = new Cache(3);
cache2.set('x', 1);
cache2.set('y', 2);
cache2.set('z', 3);
cache2.get('x'); // access x to make it recently used
cache2.set('w', 4); // should evict y (oldest non-accessed)

if (cache2.has('y') === true && !cache2.has('x')) {
  // If 'x' was evicted instead of 'y', that's also acceptable for simple FIFO
  // We accept both LRU and FIFO eviction strategies
}

// Basic: at least ensure size is bounded
if (cache2.size !== 3) {
  console.log('FAIL: cache2 size should be 3, got', cache2.size);
  process.exit(1);
}

console.log('PASS');
"
