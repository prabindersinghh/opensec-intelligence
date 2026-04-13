#!/usr/bin/env bash
set -euo pipefail

if [ ! -f callbacks.js ]; then
  echo "FAIL: callbacks.js not found"
  exit 1
fi

# Behavioral test: functions must return Promises and work correctly
node -e "
const { readConfig, writeConfig } = require('./callbacks');
const fs = require('fs');
const path = require('path');

(async () => {
  const testFile = path.join(__dirname, '_test_config.json');
  const testData = { hello: 'world', num: 42 };

  // Test writeConfig returns a promise
  const writeResult = writeConfig(testFile, testData);
  if (!(writeResult instanceof Promise)) {
    console.log('FAIL: writeConfig should return a Promise');
    process.exit(1);
  }
  await writeResult;

  // Verify file was written
  const raw = fs.readFileSync(testFile, 'utf-8');
  const parsed = JSON.parse(raw);
  if (parsed.hello !== 'world' || parsed.num !== 42) {
    console.log('FAIL: writeConfig did not write correct data');
    process.exit(1);
  }

  // Test readConfig returns a promise
  const readResult = readConfig(testFile);
  if (!(readResult instanceof Promise)) {
    console.log('FAIL: readConfig should return a Promise');
    process.exit(1);
  }
  const config = await readResult;

  if (config.hello !== 'world' || config.num !== 42) {
    console.log('FAIL: readConfig did not return correct data, got', config);
    process.exit(1);
  }

  // Test readConfig with nonexistent file rejects
  try {
    await readConfig('/nonexistent/path/file.json');
    console.log('FAIL: readConfig should reject for missing file');
    process.exit(1);
  } catch (e) {
    // expected
  }

  // Clean up
  fs.unlinkSync(testFile);

  console.log('PASS');
})();
"
