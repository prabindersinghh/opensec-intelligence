#!/bin/bash
node -e "
const m = require('./utils.js');
// isValidEmail must be exported
if (typeof m.isValidEmail !== 'function') process.exit(1);
// Test it
if (m.isValidEmail('test@example.com') !== true) process.exit(1);
if (m.isValidEmail('invalid') !== false) process.exit(1);
// Existing functions must still work
const user = m.createUser('Test', 'test@example.com');
if (user.name !== 'Test') process.exit(1);
try { m.createUser('Test', 'bad'); process.exit(1); } catch {}
"
