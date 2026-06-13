// Demo vulnerable app — intentionally insecure.
const express = require('express')
const { exec } = require('child_process')
const crypto = require('crypto')
const app = express()

// CORS misconfiguration — allows any origin.
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  next()
})

// SQL injection — query built via string interpolation.
app.get('/user', (req, res) => {
  const id = req.query.id
  db.query(`SELECT * FROM users WHERE id = ${id}`, (err, rows) => {
    res.json(rows)
  })
})

// Command injection — user input passed to a shell.
app.get('/ping', (req, res) => {
  exec(`ping -c 1 ${req.query.host}`, (err, stdout) => {
    res.send(stdout)
  })
})

// Open redirect — destination from request input.
app.get('/go', (req, res) => {
  res.redirect(req.query.next)
})

// Weak hashing for passwords.
function hashPassword(pw) {
  return crypto.createHash('md5').update(pw).digest('hex')
}

// Insecure randomness for a session token.
function sessionToken() {
  return Math.random().toString(36).slice(2)
}

// Plaintext external endpoint.
const TELEMETRY = 'http://telemetry.example.com/collect'

app.listen(3000)
