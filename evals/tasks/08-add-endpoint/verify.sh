#!/bin/bash
# Verify the /health endpoint exists and returns { status: 'ok' }
node -e "
const { routes } = require('./server.js');
const handler = routes['GET /health'];
if (!handler) process.exit(1);
// Simulate a response
let body = '';
const res = {
  writeHead: () => {},
  end: (data) => { body = data; },
};
handler({}, res);
const parsed = JSON.parse(body);
if (parsed.status !== 'ok') process.exit(1);
"
