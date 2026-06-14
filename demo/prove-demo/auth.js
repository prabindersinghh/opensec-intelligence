const crypto = require('crypto')

// VULN 1: MD5 password hashing
function hashPassword(password) {
  return crypto.createHash('md5').update(password).digest('hex')
}

// VULN 2: hardcoded JWT secret
const JWT_SECRET = 'supersecretkey123'

function generateToken(userId) {
  return Buffer.from(userId + ':' + JWT_SECRET).toString('base64')
}

// VULN 3: Math.random() for session token
function generateSessionToken() {
  const token = Math.random().toString(36).substring(2)
  return token
}

module.exports = { hashPassword, generateToken, generateSessionToken, JWT_SECRET }
