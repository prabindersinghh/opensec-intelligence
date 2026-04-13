#!/bin/bash
node -e "
const { average } = require('./calculate.js');
if (average([2, 4, 6]) !== 4) process.exit(1);
if (average([10]) !== 10) process.exit(1);
if (average([1, 2, 3, 4, 5]) !== 3) process.exit(1);
"
