#!/usr/bin/env bash
set -euo pipefail

if [ ! -f event-emitter.js ]; then
  echo "FAIL: event-emitter.js not found"
  exit 1
fi

node -e "
const mod = require('./event-emitter');
const EventEmitter = typeof mod === 'function' ? mod : (mod.EventEmitter || mod.default);
if (!EventEmitter) { console.log('FAIL: could not find EventEmitter export'); process.exit(1); }

const emitter = new EventEmitter();
const results = [];

// Test on + emit
const handler = (val) => results.push(val);
emitter.on('data', handler);
emitter.emit('data', 'hello');
if (results.length !== 1 || results[0] !== 'hello') {
  console.log('FAIL: on+emit did not work, got', results);
  process.exit(1);
}

// Test multiple listeners
const handler2 = (val) => results.push(val + '!');
emitter.on('data', handler2);
emitter.emit('data', 'world');
if (results.length !== 4 || results[1] !== 'world' || results[2] !== 'world' || results[3] !== 'world!') {
  // results should be: ['hello', 'world', 'world!'] — wait, let me reconsider
  // After first emit: ['hello']
  // After second emit with 2 handlers: ['hello', 'world', 'world!']
  if (JSON.stringify(results) !== JSON.stringify(['hello', 'world', 'world!'])) {
    console.log('FAIL: multiple listeners, got', JSON.stringify(results));
    process.exit(1);
  }
}

// Test off
emitter.off('data', handler);
results.length = 0;
emitter.emit('data', 'test');
if (results.length !== 1 || results[0] !== 'test!') {
  console.log('FAIL: off did not remove handler, got', JSON.stringify(results));
  process.exit(1);
}

// Test emit with multiple args
const multiArgs = [];
emitter.on('multi', (a, b, c) => multiArgs.push(a, b, c));
emitter.emit('multi', 1, 2, 3);
if (JSON.stringify(multiArgs) !== '[1,2,3]') {
  console.log('FAIL: multiple args, got', JSON.stringify(multiArgs));
  process.exit(1);
}

// Test emit with no listeners doesn't throw
try {
  emitter.emit('nonexistent', 'data');
} catch (e) {
  console.log('FAIL: emit on nonexistent event should not throw');
  process.exit(1);
}

console.log('PASS');
"
