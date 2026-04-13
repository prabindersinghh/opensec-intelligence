#!/bin/bash
# logger.js must exist and export a log function
[[ -f logger.js ]] || exit 1
node -e "const l = require('./logger.js'); if (typeof l.log !== 'function') process.exit(1);"

# app.js and worker.js must require logger
grep -q "require.*logger" app.js || exit 1
grep -q "require.*logger" worker.js || exit 1

# Both must still work
node -e "const a = require('./app.js'); if (a.start() !== true) process.exit(1);"
node -e "const w = require('./worker.js'); if (w.process('hello') !== 'HELLO') process.exit(1);"
