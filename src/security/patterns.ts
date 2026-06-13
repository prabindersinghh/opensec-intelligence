/**
 * Deterministic security detection patterns.
 *
 * These run with no LLM — pure regex over file contents — so the Scanner stays
 * fast and reproducible. The Analyst (LLM) is layered on top to confirm/triage.
 *
 * Lines that contain the marker `opensec-ignore` are skipped by the Scanner,
 * which is how this file avoids matching its own rule literals when OpenSec
 * scans its own source.
 */

import type { SecurityPattern } from './types.js'

export const SECRET_PATTERNS: SecurityPattern[] = [
  {
    name: 'AWS Access Key',
    regex: /AKIA[0-9A-Z]{16}/, // opensec-ignore
    severity: 'CRITICAL',
    category: 'secret',
    description: 'A hardcoded AWS access key ID was found in source.',
    remediation: 'Revoke the key in IAM immediately and load credentials from environment variables or a secrets manager.',
  },
  {
    name: 'AWS Secret Key',
    regex: /aws_secret_access_key\s*=\s*[^\s]{20,}/i, // opensec-ignore
    severity: 'CRITICAL',
    category: 'secret',
    description: 'A hardcoded AWS secret access key was found.',
    remediation: 'Rotate the secret immediately and inject it via environment variables or a secrets manager.',
  },
  {
    name: 'Private Key',
    regex: /-----BEGIN (RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/, // opensec-ignore
    severity: 'CRITICAL',
    category: 'secret',
    description: 'A PEM-encoded private key is committed to the repository.',
    remediation: 'Remove the key from history (git filter-repo), rotate it, and store keys outside the repo.',
  },
  {
    name: 'GitHub Token',
    regex: /ghp_[a-zA-Z0-9]{36}/, // opensec-ignore
    severity: 'CRITICAL',
    category: 'secret',
    description: 'A GitHub personal access token is hardcoded.',
    remediation: 'Revoke the token in GitHub settings and use repository or environment secrets instead.',
  },
  {
    name: 'Hardcoded Password',
    regex: /password\s*[=:]\s*["'][^"']{6,}["']/i, // opensec-ignore
    severity: 'HIGH',
    category: 'secret',
    description: 'A password appears to be hardcoded as a string literal.',
    remediation: 'Move the password to an environment variable or secrets manager; never commit credentials.',
  },
  {
    name: 'Hardcoded API Key',
    regex: /api[_-]?key\s*[=:]\s*["'][^"']{10,}["']/i, // opensec-ignore
    severity: 'HIGH',
    category: 'secret',
    description: 'An API key appears to be hardcoded as a string literal.',
    remediation: 'Load the API key from configuration/environment at runtime instead of committing it.',
  },
  {
    name: 'JWT Secret',
    regex: /jwt[_-]?secret\s*[=:]\s*["'][^"']{8,}["']/i, // opensec-ignore
    severity: 'HIGH',
    category: 'secret',
    description: 'A JWT signing secret is hardcoded.',
    remediation: 'Store the signing secret in an environment variable; rotate any exposed secret.',
  },
  {
    name: 'Database URL with credentials',
    regex: /(?:postgres|mysql|mongodb):\/\/[^:\s]+:[^@\s]+@/, // opensec-ignore
    severity: 'HIGH',
    category: 'secret',
    description: 'A database connection string embeds inline username:password credentials.',
    remediation: 'Use a credential-less DSN and supply username/password via environment variables.',
  },
  {
    name: 'Slack Token',
    regex: /xox[baprs]-[0-9a-zA-Z-]{10,}/, // opensec-ignore
    severity: 'HIGH',
    category: 'secret',
    description: 'A Slack API token is hardcoded.',
    remediation: 'Revoke the token in the Slack admin console and load it from a secret store.',
  },
  {
    name: 'Generic Secret',
    regex: /secret\s*[=:]\s*["'][^"']{8,}["']/i, // opensec-ignore
    severity: 'MEDIUM',
    category: 'secret',
    description: 'A value named "secret" is assigned a hardcoded string literal.',
    remediation: 'Confirm this is not sensitive; if it is, move it to environment/secret storage.',
  },
]

export const CODE_PATTERNS: SecurityPattern[] = [
  {
    name: 'SQL Injection Risk',
    regex: /(?:query|execute|exec)\s*\(\s*[`"'].*\$\{|f["'].*SELECT.*\{/i, // opensec-ignore
    severity: 'HIGH',
    category: 'code',
    description: 'A SQL statement is built with string interpolation, allowing injection.',
    remediation: 'Use parameterized queries / prepared statements instead of string interpolation.',
  },
  {
    name: 'Command Injection',
    regex: /(?:exec|spawn|system|popen)\s*\([^)]*\$(?:\{[^}]+\}|[a-zA-Z_]\w*)/, // opensec-ignore
    severity: 'CRITICAL',
    category: 'code',
    description: 'A shell command is constructed from interpolated input, allowing command injection.',
    remediation: 'Avoid shells; pass arguments as an array to execFile/spawn and validate/escape all input.',
  },
  {
    name: 'Eval Usage',
    regex: /\beval\s*\(/, // opensec-ignore
    severity: 'HIGH',
    category: 'code',
    description: 'Use of eval() can execute arbitrary code from untrusted input.',
    remediation: 'Remove eval(); use JSON.parse, a safe expression parser, or explicit dispatch.',
  },
  {
    name: 'Debug Mode in Prod',
    regex: /DEBUG\s*=\s*True|debug\s*:\s*true/, // opensec-ignore
    severity: 'MEDIUM',
    category: 'code',
    description: 'Debug mode appears to be enabled, which can leak stack traces and internals.',
    remediation: 'Drive debug flags from environment and ensure production runs with debug disabled.',
  },
  {
    name: 'HTTP not HTTPS',
    // Excludes localhost and well-known non-fetchable XML/schema namespace hosts.
    regex: /http:\/\/(?!localhost|127\.0\.0\.1|0\.0\.0\.0|www\.w3\.org|schemas\.|[^/\s]*\.local)/, // opensec-ignore
    severity: 'MEDIUM',
    category: 'code',
    description: 'A plaintext (non-TLS) URL to a non-local host was found.',
    remediation: 'Use TLS for all external endpoints to prevent eavesdropping and tampering.',
  },
  {
    name: 'CORS Wildcard',
    regex: /Access-Control-Allow-Origin['":\s]+\*/, // opensec-ignore
    severity: 'HIGH',
    category: 'code',
    description: 'CORS is configured to allow any origin (*), exposing the API to any site.',
    remediation: 'Restrict Access-Control-Allow-Origin to an explicit allowlist of trusted origins.',
  },
  {
    name: 'Weak Crypto',
    regex: /\b(?:md5|sha1|DES|RC4)\b/i, // opensec-ignore
    severity: 'HIGH',
    category: 'code',
    description: 'A weak or broken cryptographic primitive is referenced.',
    remediation: 'Use SHA-256+/bcrypt/argon2 for hashing and AES-GCM for encryption.',
  },
  {
    name: 'Insecure Random',
    regex: /Math\.random\(\)|random\.random\(\)/, // opensec-ignore
    severity: 'MEDIUM',
    category: 'code',
    description: 'A non-cryptographic RNG is used; unsafe for tokens, IDs, or secrets.',
    remediation: 'Use crypto.randomBytes / secrets module for any security-sensitive randomness.',
  },
  {
    name: 'Open Redirect',
    regex: /redirect\s*\(.*(?:req\.|request\.|params\.)/, // opensec-ignore
    severity: 'HIGH',
    category: 'code',
    description: 'A redirect target is derived from request input, enabling open redirects.',
    remediation: 'Validate redirect targets against an allowlist of internal paths.',
  },
  {
    name: 'XXE Risk',
    regex: /XMLParser|etree\.parse|DOMParser/, // opensec-ignore
    severity: 'MEDIUM',
    category: 'code',
    description: 'XML parsing without disabling external entities can allow XXE.',
    remediation: 'Disable DTD/external-entity resolution in the XML parser configuration.',
  },
]

export const INFRA_PATTERNS: SecurityPattern[] = [
  {
    name: 'Root Container',
    regex: /USER root|user:\s*root/, // opensec-ignore
    severity: 'HIGH',
    category: 'infra',
    description: 'A container is configured to run as the root user.',
    remediation: 'Add a non-root USER directive and run the workload with least privilege.',
    files: ['Dockerfile', 'docker-compose.yml', '*.yaml', '*.yml'],
  },
  {
    name: 'Privileged Container',
    regex: /privileged:\s*true/, // opensec-ignore
    severity: 'CRITICAL',
    category: 'infra',
    description: 'A container requests privileged mode, granting host-level access.',
    remediation: 'Remove privileged:true; grant only the specific capabilities required.',
    files: ['*.yaml', '*.yml', 'docker-compose.yml'],
  },
  {
    name: 'Host Network',
    regex: /network_mode:\s*host|hostNetwork:\s*true/, // opensec-ignore
    severity: 'HIGH',
    category: 'infra',
    description: 'The container shares the host network namespace, bypassing isolation.',
    remediation: 'Use bridge/pod networking and expose only the ports you need.',
    files: ['*.yaml', '*.yml', 'docker-compose.yml'],
  },
  {
    name: 'Latest Tag',
    regex: /FROM\s+\S+:latest/, // opensec-ignore
    severity: 'MEDIUM',
    category: 'infra',
    description: 'A base image is pinned to the mutable :latest tag.',
    remediation: 'Pin base images to a specific version or digest for reproducible, auditable builds.',
    files: ['Dockerfile'],
  },
  {
    name: 'Exposed Secret in Env',
    regex: /(?:SECRET|PASSWORD|API_?KEY|TOKEN)\s*[:=]\s*["']?[^\s"']{6,}/, // opensec-ignore
    severity: 'HIGH',
    category: 'infra',
    description: 'A secret-like environment value is defined inline in an infra file.',
    remediation: 'Reference secrets from a vault/secret manager rather than inlining them.',
    files: ['*.yaml', '*.yml', 'docker-compose.yml', 'Dockerfile'],
  },
]

export const ALL_PATTERNS: SecurityPattern[] = [
  ...SECRET_PATTERNS,
  ...CODE_PATTERNS,
  ...INFRA_PATTERNS,
]
