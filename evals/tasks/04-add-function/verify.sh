#!/bin/bash
node -e "const m = require('./math.js'); if (m.multiply(3, 4) !== 12) process.exit(1); if (m.multiply(0, 5) !== 0) process.exit(1);"
