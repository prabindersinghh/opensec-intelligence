const http = require('http');
const fs = require('fs');
const path = require('path');

// Simulated database
const db = {
  query: function(sql) {
    // This simulates a SQL query
    return { sql, results: [] };
  }
};

function handleRequest(req, res) {
  const url = new URL(req.url, 'http://localhost');
  
  if (url.pathname === '/search') {
    const query = url.searchParams.get('q') || '';
    // SQL injection vulnerability
    const result = db.query("SELECT * FROM users WHERE name = '" + query + "'");
    res.writeHead(200, { 'Content-Type': 'text/html' });
    // XSS vulnerability
    res.end('<h1>Results for: ' + query + '</h1>');
  }
  
  if (url.pathname === '/file') {
    const filename = url.searchParams.get('name') || 'readme.txt';
    // Path traversal vulnerability  
    const content = fs.readFileSync(path.join('./public', filename), 'utf-8');
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end(content);
  }
}

module.exports = { handleRequest, db };
