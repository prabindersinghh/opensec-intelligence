#!/usr/bin/env bash
set -euo pipefail

if [ ! -f linked-list.js ]; then
  echo "FAIL: linked-list.js not found"
  exit 1
fi

node -e "
const mod = require('./linked-list');
const LinkedList = typeof mod === 'function' ? mod : (mod.LinkedList || mod.default);
if (!LinkedList) { console.log('FAIL: could not find LinkedList export'); process.exit(1); }

const list = new LinkedList();

// Test empty list
if (list.size() !== 0) {
  console.log('FAIL: empty list size should be 0, got', list.size());
  process.exit(1);
}
if (JSON.stringify(list.toArray()) !== '[]') {
  console.log('FAIL: empty list toArray should be [], got', JSON.stringify(list.toArray()));
  process.exit(1);
}

// Test append
list.append(1);
list.append(2);
list.append(3);
if (list.size() !== 3) {
  console.log('FAIL: after 3 appends, size should be 3, got', list.size());
  process.exit(1);
}
if (JSON.stringify(list.toArray()) !== '[1,2,3]') {
  console.log('FAIL: after appends, toArray should be [1,2,3], got', JSON.stringify(list.toArray()));
  process.exit(1);
}

// Test prepend
list.prepend(0);
if (list.size() !== 4) {
  console.log('FAIL: after prepend, size should be 4, got', list.size());
  process.exit(1);
}
if (JSON.stringify(list.toArray()) !== '[0,1,2,3]') {
  console.log('FAIL: after prepend, toArray should be [0,1,2,3], got', JSON.stringify(list.toArray()));
  process.exit(1);
}

// Test prepend on empty list
const list2 = new LinkedList();
list2.prepend(42);
if (list2.size() !== 1) {
  console.log('FAIL: prepend on empty, size should be 1, got', list2.size());
  process.exit(1);
}
if (JSON.stringify(list2.toArray()) !== '[42]') {
  console.log('FAIL: prepend on empty, toArray should be [42], got', JSON.stringify(list2.toArray()));
  process.exit(1);
}

console.log('PASS');
"
