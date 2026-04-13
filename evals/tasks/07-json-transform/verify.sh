#!/bin/bash
[[ -f output.json ]] || exit 1
# Check that output contains exactly 3 active items
node -e "
const d = require('./output.json');
if (!Array.isArray(d)) process.exit(1);
if (d.length !== 3) process.exit(1);
if (!d.every(i => i.active === true)) process.exit(1);
"
