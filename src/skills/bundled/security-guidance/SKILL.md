---
name: security-guidance
description: "Security best practices for web applications and Node.js code"
---

# Security Guidance

## Instructions

When writing or reviewing code, always consider security:

### Input Validation
- **Never trust user input** — validate and sanitize all external data
- Use allowlists over denylists
- Validate types, lengths, ranges, and formats

### Injection Prevention
- **SQL**: Use parameterized queries, never concatenate user input into SQL strings
- **XSS**: Escape HTML output, use Content-Security-Policy headers
- **Command injection**: Use `execFile` over `exec`, never pass user input to shell commands
- **Path traversal**: Validate file paths with `path.resolve()` and check they're within expected directory

### Authentication & Authorization
- Hash passwords with bcrypt or scrypt (never MD5/SHA1)
- Use constant-time comparison for secrets
- Implement proper session management
- Validate authorization on every request, not just at the UI level

### Data Protection
- Never log sensitive data (passwords, tokens, PII)
- Use HTTPS for all network communication
- Set secure cookie flags: `httpOnly`, `secure`, `sameSite`

### Dependencies
- Keep dependencies updated
- Audit with `npm audit`
- Pin dependency versions in production

### Error Handling
- Never expose stack traces or internal errors to users
- Log errors server-side with context
- Return generic error messages to clients
