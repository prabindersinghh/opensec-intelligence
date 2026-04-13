#!/bin/bash
set -euo pipefail

# Behavioral security testing — attempt actual exploits rather than source grep

# Test 1: XSS — injected script tag must be escaped in output
node -e "
const { handleRequest } = require('./webapp.js');
let body = '';
const mockRes = {
  writeHead: () => {},
  end: (data) => { body = typeof data === 'string' ? data : ''; }
};
const mockReq = { url: '/search?q=<script>alert(1)</script>' };
handleRequest(mockReq, mockRes);
if (body.includes('<script>')) {
  console.error('XSS vulnerability still present — raw script tag in output');
  process.exit(1);
}
console.log('XSS fix verified');
"

# Test 2: SQL injection — parameterized query or escaped input
node -e "
const { handleRequest, db } = require('./webapp.js');
// Monkey-patch db.query to capture the SQL
let capturedSql = '';
const origQuery = db.query;
db.query = function(sql, params) {
  capturedSql = sql;
  return origQuery.apply(this, arguments);
};
const mockRes = { writeHead: () => {}, end: () => {} };
const mockReq = { url: \"/search?q='; DROP TABLE users; --\" };
handleRequest(mockReq, mockRes);
// The captured SQL should not contain the raw injection payload
if (capturedSql.includes(\"DROP TABLE\")) {
  console.error('SQL injection vulnerability still present');
  process.exit(1);
}
console.log('SQL injection fix verified');
"

# Test 3: Path traversal — accessing ../etc/passwd should fail or be blocked
node -e "
const { handleRequest } = require('./webapp.js');
let statusCode = 200;
let body = '';
const mockRes = {
  writeHead: (code) => { statusCode = code; },
  end: (data) => { body = typeof data === 'string' ? data : ''; }
};
const mockReq = { url: '/file?name=../../etc/passwd' };
try {
  handleRequest(mockReq, mockRes);
} catch (e) {
  // Throwing is acceptable — means the traversal was caught
  console.log('Path traversal fix verified (threw error)');
  process.exit(0);
}
// If it didn't throw, check it returned an error status or empty content
if (statusCode >= 400 || body === '') {
  console.log('Path traversal fix verified (status ' + statusCode + ')');
} else {
  console.error('Path traversal vulnerability may still be present');
  process.exit(1);
}
"
