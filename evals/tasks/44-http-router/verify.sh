#!/bin/bash
set -euo pipefail

# Router exists and handles routes
node -e "
const mod = require('./router.js');
const Router = typeof mod === 'function' ? mod : (mod.Router || mod.default);
if (!Router) { console.error('Could not find Router export'); process.exit(1); }
const r = new Router();

r.get('/users', () => 'all users');
r.get('/users/:id', (params) => 'user ' + params.id);
r.post('/users', () => 'created');

// Test basic route matching
let match = r.handle('GET', '/users');
if (!match || !match.handler) { console.error('GET /users not found'); process.exit(1); }

// Test param extraction
match = r.handle('GET', '/users/42');
if (!match || !match.params || match.params.id !== '42') {
  console.error('Param extraction failed');
  process.exit(1);
}

// Test POST
match = r.handle('POST', '/users');
if (!match || !match.handler) { console.error('POST /users not found'); process.exit(1); }

// Test 404
match = r.handle('GET', '/nonexistent');
if (match && match.handler) { console.error('Should not match /nonexistent'); process.exit(1); }
"

# Middleware exists
[[ -f middleware.js ]] || exit 1

# Server exists
[[ -f server.js ]] || exit 1
