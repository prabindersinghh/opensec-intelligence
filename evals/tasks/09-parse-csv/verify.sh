#!/bin/bash
[[ -f parse.js ]] || exit 1
node parse.js 2>/dev/null
[[ -f data.json ]] || exit 1
node -e "
const d = require('./data.json');
if (!Array.isArray(d) || d.length !== 3) process.exit(1);
if (d[0].name !== 'Alice') process.exit(1);
if (d[2].city !== 'Paris') process.exit(1);
"
