function createUser(name, email) {
  return { id: Date.now(), name, email, createdAt: new Date().toISOString() };
}
module.exports = { createUser };
