#!/bin/bash
node -e "
const m = require('./utils.js');
if (typeof m.capitalize !== 'function') process.exit(1);
if (m.capitalize('hello') !== 'Hello') process.exit(1);
if (m.capitalize('world') !== 'World') process.exit(1);
if (m.capitalize('') !== '') process.exit(1);
"
