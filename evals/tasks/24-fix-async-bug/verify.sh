#!/usr/bin/env bash
set -euo pipefail

if [ ! -f fetcher.js ]; then
  echo "FAIL: fetcher.js not found"
  exit 1
fi

node -e "
// Mock fetch
global.fetch = async (url) => ({
  text: async () => 'response-from-' + url
});

const { fetchAll } = require('./fetcher');

(async () => {
  const results = await fetchAll(['url1', 'url2', 'url3']);

  if (!Array.isArray(results)) {
    console.log('FAIL: fetchAll should return an array, got', typeof results);
    process.exit(1);
  }

  if (results.length !== 3) {
    console.log('FAIL: fetchAll should return 3 results, got', results.length);
    process.exit(1);
  }

  // Check all results are populated (not empty)
  for (const r of results) {
    if (!r || !r.startsWith('response-from-')) {
      console.log('FAIL: unexpected result value', r);
      process.exit(1);
    }
  }

  console.log('PASS');
})();
"
