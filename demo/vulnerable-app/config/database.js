// Demo vulnerable app — intentionally insecure for OpenSec demonstrations.
// DO NOT use any of this in real code.

const config = {
  host: 'db.example.com',
  // Hardcoded credentials — should come from environment.
  password: 'SuperSecret123!',
  apiKey: 'sk_live_EXAMPLE_DO_NOT_USE_IN_PROD',
  jwtSecret: 'my-jwt-signing-secret-value',
  // Connection string with inline credentials.
  url: 'postgres://admin:hunter2@db.example.com:5432/prod',
}

module.exports = config
