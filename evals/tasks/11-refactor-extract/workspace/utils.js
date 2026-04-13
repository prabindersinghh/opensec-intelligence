function createUser(name, email) {
  // Validate email inline
  if (!email || !email.includes('@') || !email.includes('.')) {
    throw new Error('Invalid email');
  }

  return { name, email, createdAt: new Date() };
}

function updateEmail(user, newEmail) {
  // Same validation repeated
  if (!newEmail || !newEmail.includes('@') || !newEmail.includes('.')) {
    throw new Error('Invalid email');
  }

  return { ...user, email: newEmail };
}

module.exports = { createUser, updateEmail };
