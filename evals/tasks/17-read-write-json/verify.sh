#!/usr/bin/env bash
set -euo pipefail

if [ ! -f config.json ]; then
  echo "FAIL: config.json not found"
  exit 1
fi

content=$(cat config.json)

# Check that the new key exists
if ! echo "$content" | grep -q '"version"'; then
  echo "FAIL: config.json missing 'version' key"
  exit 1
fi

if ! echo "$content" | grep -q '"2\.0\.0"'; then
  echo "FAIL: config.json missing version value '2.0.0'"
  exit 1
fi

# Check original keys are preserved
if ! echo "$content" | grep -q '"myapp"'; then
  echo "FAIL: config.json missing original 'name' value"
  exit 1
fi

if ! echo "$content" | grep -q '"port"'; then
  echo "FAIL: config.json missing original 'port' key"
  exit 1
fi

# Validate it's still valid JSON
if ! node -e "JSON.parse(require('fs').readFileSync('config.json','utf-8'))"; then
  echo "FAIL: config.json is not valid JSON"
  exit 1
fi

echo "PASS"
exit 0
