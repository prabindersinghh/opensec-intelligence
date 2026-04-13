#!/bin/bash
# Verify 'count' is used and 'x' (as a variable, not in words) is not
grep -q "count" counter.js && ! grep -qP '\bx\b' counter.js
