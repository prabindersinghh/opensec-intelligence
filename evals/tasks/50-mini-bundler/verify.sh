#!/bin/bash
set -euo pipefail

# Both files must exist
[[ -f bundler.js ]] || { echo "bundler.js missing"; exit 1; }
[[ -f cli.js ]] || { echo "cli.js missing"; exit 1; }

# Run the bundler on the sample entry
node cli.js src/index.js

# bundle.js must be produced
[[ -f bundle.js ]] || { echo "bundle.js not generated"; exit 1; }

# Running the bundle should produce output from the sample modules:
# src/index.js does: console.log(add(2,3)) and console.log(greet('World'))
# Expected: the number 5 and a greeting containing "Hello" and "World"
OUTPUT=$(node bundle.js 2>&1)

# Must produce at least 2 lines of output
LINE_COUNT=$(echo "$OUTPUT" | wc -l | tr -d ' ')
if [[ "$LINE_COUNT" -lt 2 ]]; then
  echo "Expected at least 2 lines of output, got $LINE_COUNT"
  exit 1
fi

# The add(2,3) result should appear in output
echo "$OUTPUT" | grep -qE '5' || { echo "Expected add(2,3)=5 in output"; exit 1; }

# The greet function output should contain both Hello and World
echo "$OUTPUT" | grep -qi 'Hello' || { echo "Expected greeting with Hello"; exit 1; }
echo "$OUTPUT" | grep -qi 'World' || { echo "Expected greeting with World"; exit 1; }

echo "All mini-bundler tests passed"
