const crypto = require('crypto')

function hashPassword(password) {
  return crypto.createHash('md5').update(password).digest('hex')
}

const JWT_SECRET = 'supersecretkey123'

function generateToken(userId) {
  return Buffer.from(userId + ':' + JWT_SECRET).toString('base64')
}

function generateSessionToken() {
  const token = Math.random().toString(36).substring(2)
  return token
}

module.exports = { hashPassword, generateToken, generateSessionToken, JWT_SECRET }
