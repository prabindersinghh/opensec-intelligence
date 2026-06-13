/**
 * Authentication module — intentionally vulnerable for fixer testing.
 *
 * This file is a fixture for `opensec fix`.  Do NOT deploy to production.
 */
const crypto = require('crypto')
const jwt = require('jsonwebtoken')

// VULN: MD5 for password hashing
function hashPassword(pw) {
  return crypto.createHash('md5').update(pw).digest('hex')
}

// VULN: JWT signing secret hardcoded
const JWT_SECRET = 'super-secret-jwt-key-do-not-use'

function signToken(userId) {
  return jwt.sign({ id: userId }, JWT_SECRET, { expiresIn: '1h' })
}

// VULN: Math.random() assigned to a security-sensitive variable (token)
function generateResetToken() {
  const token = Math.random().toString(36).slice(2)
  return token
}

module.exports = { hashPassword, signToken, generateResetToken }
