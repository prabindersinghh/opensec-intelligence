#!/usr/bin/env bash
set -euo pipefail

# Verifier sets cwd to workspace; WORKSPACE env var also available

# Check source doesn't use JSON.parse or structuredClone
if grep -q 'JSON\.parse' deep-clone.js; then
  echo "Must not use JSON.parse"
  exit 1
fi
if grep -q 'JSON\.stringify' deep-clone.js; then
  echo "Must not use JSON.stringify"
  exit 1
fi
if grep -q 'structuredClone' deep-clone.js; then
  echo "Must not use structuredClone"
  exit 1
fi

node -e "
const mod = require('./deep-clone.js');
const deepClone = typeof mod === 'function' ? mod : (mod.deepClone || mod.default);

// Test plain object
const obj = { a: 1, b: { c: 2, d: [3, 4] } };
const clonedObj = deepClone(obj);
clonedObj.b.c = 99;
clonedObj.b.d.push(5);
if (obj.b.c !== 2) { console.error('Object clone not independent (nested obj)'); process.exit(1); }
if (obj.b.d.length !== 2) { console.error('Object clone not independent (nested array)'); process.exit(1); }

// Test array
const arr = [1, [2, 3], { x: 4 }];
const clonedArr = deepClone(arr);
clonedArr[1].push(99);
clonedArr[2].x = 99;
if (arr[1].length !== 2) { console.error('Array clone not independent'); process.exit(1); }
if (arr[2].x !== 4) { console.error('Nested object in array not independent'); process.exit(1); }

// Test Date
const date = new Date('2024-01-15');
const clonedDate = deepClone(date);
if (!(clonedDate instanceof Date)) { console.error('Date clone must be Date instance'); process.exit(1); }
if (clonedDate.getTime() !== date.getTime()) { console.error('Date clone value mismatch'); process.exit(1); }
if (clonedDate === date) { console.error('Date clone must be different reference'); process.exit(1); }

// Test RegExp
const regex = /test/gi;
const clonedRegex = deepClone(regex);
if (!(clonedRegex instanceof RegExp)) { console.error('RegExp clone must be RegExp instance'); process.exit(1); }
if (clonedRegex.source !== 'test' || clonedRegex.flags !== 'gi') { console.error('RegExp clone value mismatch'); process.exit(1); }

// Test Map
const map = new Map([['a', 1], ['b', { nested: true }]]);
const clonedMap = deepClone(map);
if (!(clonedMap instanceof Map)) { console.error('Map clone must be Map instance'); process.exit(1); }
if (clonedMap.get('a') !== 1) { console.error('Map value mismatch'); process.exit(1); }
clonedMap.get('b').nested = false;
if (map.get('b').nested !== true) { console.error('Map clone not independent'); process.exit(1); }

// Test Set
const set = new Set([1, 2, 3]);
const clonedSet = deepClone(set);
if (!(clonedSet instanceof Set)) { console.error('Set clone must be Set instance'); process.exit(1); }
if (clonedSet.size !== 3) { console.error('Set size mismatch'); process.exit(1); }
if (clonedSet === set) { console.error('Set clone must be different reference'); process.exit(1); }

console.log('All deep clone tests passed');
"
