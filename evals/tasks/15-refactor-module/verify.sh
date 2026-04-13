#!/bin/bash
# All three modules must exist
[[ -f db.js ]] || exit 1
[[ -f auth.js ]] || exit 1
[[ -f api.js ]] || exit 1

node -e "
// Each module exports its functions
const db = require('./db.js');
if (typeof db.connect !== 'function' || typeof db.query !== 'function') process.exit(1);

const auth = require('./auth.js');
if (typeof auth.login !== 'function' || typeof auth.verify !== 'function') process.exit(1);

const api = require('./api.js');
if (typeof api.handleGetUsers !== 'function' || typeof api.handleCreateUser !== 'function') process.exit(1);

// monolith.js re-exports everything
const m = require('./monolith.js');
if (typeof m.connect !== 'function') process.exit(1);
if (typeof m.login !== 'function') process.exit(1);
if (typeof m.handleGetUsers !== 'function') process.exit(1);

// Functions still work correctly
if (db.connect().connected !== true) process.exit(1);
if (auth.login('admin', 'secret').token !== 'abc123') process.exit(1);
if (api.handleCreateUser({ name: 'Test' }).created !== true) process.exit(1);
"
