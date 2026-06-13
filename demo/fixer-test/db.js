/**
 * Database layer — intentionally vulnerable for fixer testing.
 *
 * Do NOT deploy to production.
 */
const mysql = require('mysql2')

// VULN: hardcoded credentials in connection string
const db = mysql.createConnection('mysql://admin:Pa$$w0rd123@prod-db.internal:3306/app')

// VULN: SQL built with string concatenation
async function getUserByName(username) {
  return new Promise((resolve, reject) => {
    db.query('SELECT * FROM users WHERE name = \'' + username + '\'', (err, rows) => {
      if (err) reject(err)
      else resolve(rows)
    })
  })
}

// VULN: SQL built with template literal interpolation
async function deleteUser(id) {
  return new Promise((resolve, reject) => {
    db.query(`DELETE FROM users WHERE id = ${id}`, (err) => {
      if (err) reject(err)
      else resolve(true)
    })
  })
}

module.exports = { db, getUserByName, deleteUser }
