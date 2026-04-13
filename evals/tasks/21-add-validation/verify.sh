#!/usr/bin/env bash
set -euo pipefail

if [ ! -f user.js ]; then
  echo "FAIL: user.js not found"
  exit 1
fi

node -e "
const { createUser } = require('./user');

// Test valid call works
const user = createUser('Alice', 'alice@example.com');
if (!user || user.name !== 'Alice' || user.email !== 'alice@example.com') {
  console.log('FAIL: valid createUser did not return expected object', user);
  process.exit(1);
}
if (!user.id || !user.createdAt) {
  console.log('FAIL: valid createUser missing id or createdAt', user);
  process.exit(1);
}

// Test empty name throws
try {
  createUser('', 'test@example.com');
  console.log('FAIL: empty name should have thrown');
  process.exit(1);
} catch (e) {
  // expected
}

// Test bad email throws (no @)
try {
  createUser('Bob', 'invalid-email');
  console.log('FAIL: email without @ should have thrown');
  process.exit(1);
} catch (e) {
  // expected
}

// Test null/undefined name throws
try {
  createUser(null, 'test@example.com');
  console.log('FAIL: null name should have thrown');
  process.exit(1);
} catch (e) {
  // expected
}

console.log('PASS');
"
