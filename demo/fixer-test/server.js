/**
 * Express server — intentionally vulnerable for fixer testing.
 *
 * Do NOT deploy to production.
 */
const express = require('express')
const cors = require('cors')
const app = express()

// VULN: CORS wildcard allows any origin
app.use(cors({ origin: '*' }))
app.use(express.json())

// VULN (intentional fixture): eval() executes arbitrary user-supplied code.
// This is deliberately insecure so opensec fix can detect and patch it.
// In production, replace with a safe math parser (e.g. mathjs evaluate()).
app.post('/calc', (req, res) => {
  const result = eval(req.body.expression) // opensec-demo-vuln
  res.json({ result })
})

// VULN: open redirect — target derived from query param
app.get('/redirect', (req, res) => {
  res.redirect(req.query.url)
})

// VULN: path traversal — filename from user input
const path = require('path')
const fs = require('fs')
app.get('/file', (req, res) => {
  const data = fs.readFileSync(req.query.name)
  res.send(data)
})

app.listen(3000)
