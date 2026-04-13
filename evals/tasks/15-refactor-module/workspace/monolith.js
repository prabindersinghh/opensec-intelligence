// Database functions
function connect() {
  return { connected: true };
}

function query(sql) {
  return { rows: [], sql };
}

// Auth functions
function login(user, pass) {
  if (user === 'admin' && pass === 'secret') return { token: 'abc123' };
  return null;
}

function verify(token) {
  return token === 'abc123';
}

// API handlers
function handleGetUsers(req) {
  return { users: [] };
}

function handleCreateUser(req) {
  return { created: true, name: req.name };
}

module.exports = {
  connect, query,
  login, verify,
  handleGetUsers, handleCreateUser,
};
