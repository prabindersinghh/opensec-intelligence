#!/usr/bin/env bash
set -euo pipefail

# Verifier sets cwd to workspace; WORKSPACE env var also available

# Verify module files exist (at minimum)
[ -f math.js ] || { echo "math.js missing"; exit 1; }
[ -f string.js ] || { echo "string.js missing"; exit 1; }
[ -f array.js ] || { echo "array.js missing"; exit 1; }
[ -f index.js ] || { echo "index.js missing"; exit 1; }

node -e "
// Test math.js exports — must have basic arithmetic functions
const math = require('./math.js');
if (typeof math.add !== 'function') { console.error('math.js must export add'); process.exit(1); }
if (typeof math.subtract !== 'function') { console.error('math.js must export subtract'); process.exit(1); }
if (typeof math.multiply !== 'function') { console.error('math.js must export multiply'); process.exit(1); }
if (math.add(2, 3) !== 5) { console.error('add(2,3) should be 5'); process.exit(1); }
if (math.subtract(5, 3) !== 2) { console.error('subtract(5,3) should be 2'); process.exit(1); }
if (math.multiply(4, 3) !== 12) { console.error('multiply(4,3) should be 12'); process.exit(1); }

// Test string.js exports
const str = require('./string.js');
if (typeof str.capitalize !== 'function') { console.error('string.js must export capitalize'); process.exit(1); }
if (typeof str.reverse !== 'function') { console.error('string.js must export reverse'); process.exit(1); }
if (typeof str.truncate !== 'function') { console.error('string.js must export truncate'); process.exit(1); }
if (str.capitalize('hello') !== 'Hello') { console.error('capitalize failed'); process.exit(1); }
if (str.reverse('abc') !== 'cba') { console.error('reverse failed'); process.exit(1); }
// truncate: must shorten and add some indicator (... or similar)
const truncated = str.truncate('hello world', 5);
if (typeof truncated !== 'string' || truncated.length > 10 || !truncated.startsWith('hello')) {
  console.error('truncate failed: got \"' + truncated + '\"'); process.exit(1);
}

// Test array.js exports
const arr = require('./array.js');
if (typeof arr.unique !== 'function') { console.error('array.js must export unique'); process.exit(1); }
if (typeof arr.flatten !== 'function') { console.error('array.js must export flatten'); process.exit(1); }
if (typeof arr.last !== 'function') { console.error('array.js must export last'); process.exit(1); }
const u = arr.unique([1,2,2,3]);
if (!Array.isArray(u) || u.length !== 3 || !u.includes(1) || !u.includes(2) || !u.includes(3)) { console.error('unique failed'); process.exit(1); }
const f = arr.flatten([[1,2],[3,4]]);
if (!Array.isArray(f) || f.length !== 4) { console.error('flatten failed'); process.exit(1); }
if (arr.last([1,2,3]) !== 3) { console.error('last failed'); process.exit(1); }

// Test index.js re-exports everything
const idx = require('./index.js');
const allFns = ['add','subtract','multiply','capitalize','reverse','truncate','unique','flatten','last'];
for (const fn of allFns) {
  if (typeof idx[fn] !== 'function') {
    console.error('index.js must re-export ' + fn);
    process.exit(1);
  }
}
// Verify index.js functions actually work
if (idx.add(1,2) !== 3) { console.error('index.js add broken'); process.exit(1); }
if (idx.capitalize('test') !== 'Test') { console.error('index.js capitalize broken'); process.exit(1); }
if (idx.last([1,2]) !== 2) { console.error('index.js last broken'); process.exit(1); }

console.log('All multi-file refactor tests passed');
"
