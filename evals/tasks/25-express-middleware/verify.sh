#!/usr/bin/env bash
set -euo pipefail

if [ ! -f middleware.js ]; then
  echo "FAIL: middleware.js not found"
  exit 1
fi

node -e "
const { logger, cors, jsonParser } = require('./middleware');

if (typeof logger !== 'function') {
  console.log('FAIL: logger is not a function');
  process.exit(1);
}
if (typeof cors !== 'function') {
  console.log('FAIL: cors is not a function');
  process.exit(1);
}
if (typeof jsonParser !== 'function') {
  console.log('FAIL: jsonParser is not a function');
  process.exit(1);
}

// Test logger calls next
let loggerNextCalled = false;
const mockReq = { method: 'GET', url: '/test' };
const mockRes = { headers: {}, setHeader(k, v) { this.headers[k] = v; } };
logger(mockReq, mockRes, () => { loggerNextCalled = true; });
if (!loggerNextCalled) {
  console.log('FAIL: logger did not call next()');
  process.exit(1);
}

// Test cors sets header and calls next
let corsNextCalled = false;
const corsRes = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, set(k, v) { this.headers[k] = v; }, header(k, v) { this.headers[k] = v; } };
cors({}, corsRes, () => { corsNextCalled = true; });
if (!corsNextCalled) {
  console.log('FAIL: cors did not call next()');
  process.exit(1);
}
const acao = corsRes.headers['Access-Control-Allow-Origin'];
if (acao !== '*') {
  console.log('FAIL: cors did not set Access-Control-Allow-Origin to *, got', acao);
  process.exit(1);
}

// Test jsonParser parses body and calls next
let parserNextCalled = false;
const jsonBody = '{\"key\":\"value\"}';
const jsonReq = {
  body: jsonBody,
  headers: { 'content-type': 'application/json' },
  // Provide stream-like interface for models that read from request stream
  on(event, cb) {
    if (event === 'data') cb(Buffer.from(jsonBody));
    if (event === 'end') cb();
    return this;
  }
};
const jsonRes = {};
jsonParser(jsonReq, jsonRes, () => { parserNextCalled = true; });
if (!parserNextCalled) {
  console.log('FAIL: jsonParser did not call next()');
  process.exit(1);
}
if (typeof jsonReq.body !== 'object' || jsonReq.body.key !== 'value') {
  console.log('FAIL: jsonParser did not parse body correctly, got', jsonReq.body);
  process.exit(1);
}

console.log('PASS');
"
