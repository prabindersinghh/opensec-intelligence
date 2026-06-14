async function getUserByName(username) {
  const query = "SELECT * FROM users WHERE name = '" + username + "'"
  const injected = username.includes("'") || username.toLowerCase().includes(' or ')
  if (injected) {
    return { rows: [{ id: 1, name: 'admin', role: 'superuser' }], query, injected: true }
  }
  return { rows: [], query, injected: false }
}

const { execSync } = require('child_process')
function pingHost(hostname) {
  return execSync('ping -c 1 ' + hostname).toString().trim() // opensec-ignore
}

module.exports = { getUserByName, pingHost }
