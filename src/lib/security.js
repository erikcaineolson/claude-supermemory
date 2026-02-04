/**
 * Security hardening module for claude-supermemory
 * Provides validation, sanitization, and security controls
 */

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

// ============================================================================
// CONFIGURATION
// ============================================================================

/**
 * Allowed API hosts - only these domains can be contacted
 * Prevents credential exfiltration via malicious SUPERMEMORY_API_URL
 */
const ALLOWED_API_HOSTS = [
  'api.supermemory.ai',
  'console.supermemory.ai',
  'mcp.supermemory.ai',
  'localhost', // For local backend
  '127.0.0.1', // For local backend (IP form)
];

/**
 * Maximum input sizes to prevent DoS attacks
 */
const MAX_STDIN_SIZE = 10 * 1024 * 1024; // 10MB max stdin
const MAX_CONTENT_LENGTH = 100000; // 100KB max content to send
const MAX_QUERY_LENGTH = 1000; // 1KB max search query
const MAX_METADATA_SIZE = 10000; // 10KB max metadata

/**
 * Patterns that indicate sensitive data - these will be redacted
 */
const SENSITIVE_PATTERNS = [
  // API keys and tokens
  /(?:api[_-]?key|apikey|token|secret|password|passwd|pwd|auth)[\s]*[=:]\s*['"]?[\w-]{10,}['"]?/gi,
  // AWS credentials
  /AKIA[0-9A-Z]{16}/g,
  /(?:aws[_-]?(?:access[_-]?key|secret))[=:]\s*['"]?[\w/+=]{20,}['"]?/gi,
  // Private keys
  /-----BEGIN (?:RSA |DSA |EC |OPENSSH )?PRIVATE KEY-----/g,
  // Connection strings
  /(?:mongodb|postgres|mysql|redis):\/\/[^\s'"]+/gi,
  // Bearer tokens
  /Bearer\s+[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
  // Generic secrets in env format
  /(?:SECRET|PRIVATE|CREDENTIAL|PASSWORD)[_A-Z]*\s*=\s*['"]?[^\s'"]{8,}['"]?/gi,
  // Supermemory API key (should never be sent in content)
  /sm_[a-zA-Z0-9]{20,}/g,
  // JWT tokens
  /eyJ[A-Za-z0-9_-]*\.eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]*/g,
  // GitHub tokens
  /gh[pousr]_[A-Za-z0-9_]{36,}/g,
  // SSH private key content
  /[A-Za-z0-9+/]{40,}={0,2}\s+[A-Za-z0-9+/]{40,}/g,
];

/**
 * File paths that should never be read or sent
 */
const SENSITIVE_PATH_PATTERNS = [
  /\.env/i,
  /credentials/i,
  /secrets?/i,
  /\.pem$/i,
  /\.key$/i,
  /id_rsa/i,
  /id_ed25519/i,
  /\.ssh\//i,
  /\.aws\//i,
  /\.gnupg\//i,
];

// ============================================================================
// URL VALIDATION
// ============================================================================

/**
 * Validate that a URL only points to allowed API hosts
 * @param {string} urlString - The URL to validate
 * @returns {{valid: boolean, reason?: string, host?: string}}
 */
function validateApiUrl(urlString) {
  if (!urlString || typeof urlString !== 'string') {
    return { valid: false, reason: 'URL is empty or not a string' };
  }

  try {
    const url = new URL(urlString);

    // Must be HTTPS (except localhost for dev)
    if (url.protocol !== 'https:' && url.hostname !== 'localhost') {
      return { valid: false, reason: 'URL must use HTTPS' };
    }

    // Check against allowlist
    const host = url.hostname.toLowerCase();
    if (!ALLOWED_API_HOSTS.includes(host)) {
      return {
        valid: false,
        reason: `Host '${host}' is not in the allowed list`,
        host,
      };
    }

    return { valid: true, host };
  } catch (err) {
    return { valid: false, reason: `Invalid URL: ${err.message}` };
  }
}

/**
 * Get validated API URL, falling back to default if env var is invalid
 * @returns {string}
 */
function getSecureApiUrl() {
  const envUrl = process.env.SUPERMEMORY_API_URL;
  const defaultUrl = 'https://api.supermemory.ai';

  if (!envUrl) {
    return defaultUrl;
  }

  const validation = validateApiUrl(envUrl);
  if (!validation.valid) {
    console.error(
      `Security: Rejecting SUPERMEMORY_API_URL (${validation.reason}), using default`,
    );
    return defaultUrl;
  }

  return envUrl;
}

/**
 * Get validated auth URL, falling back to default if env var is invalid
 * @returns {string}
 */
function getSecureAuthUrl() {
  const envUrl = process.env.SUPERMEMORY_AUTH_URL;
  const defaultUrl = 'https://console.supermemory.ai/auth/connect';

  if (!envUrl) {
    return defaultUrl;
  }

  const validation = validateApiUrl(envUrl);
  if (!validation.valid) {
    console.error(
      `Security: Rejecting SUPERMEMORY_AUTH_URL (${validation.reason}), using default`,
    );
    return defaultUrl;
  }

  return envUrl;
}

// ============================================================================
// PATH VALIDATION
// ============================================================================

/**
 * Validate a file path is safe to read
 * @param {string} filePath - The path to validate
 * @param {string[]} allowedPrefixes - Allowed path prefixes (e.g., home dir, project dir)
 * @returns {{valid: boolean, reason?: string}}
 */
function validateFilePath(filePath, allowedPrefixes = []) {
  if (!filePath || typeof filePath !== 'string') {
    return { valid: false, reason: 'Path is empty or not a string' };
  }

  // Must be absolute
  if (!path.isAbsolute(filePath)) {
    return { valid: false, reason: 'Path must be absolute' };
  }

  // Resolve to eliminate .. traversal
  const resolved = path.resolve(filePath);

  // Check if resolved path differs (indicates traversal attempt)
  if (resolved !== path.normalize(filePath)) {
    return { valid: false, reason: 'Path contains traversal sequences' };
  }

  // Check against allowed prefixes if specified
  if (allowedPrefixes.length > 0) {
    const isAllowed = allowedPrefixes.some((prefix) =>
      resolved.startsWith(prefix),
    );
    if (!isAllowed) {
      return { valid: false, reason: 'Path is outside allowed directories' };
    }
  }

  // Check for sensitive paths
  for (const pattern of SENSITIVE_PATH_PATTERNS) {
    if (pattern.test(resolved)) {
      return { valid: false, reason: 'Path matches sensitive file pattern' };
    }
  }

  return { valid: true };
}

/**
 * Validate transcript path is in the expected Claude Code location
 * @param {string} transcriptPath
 * @returns {{valid: boolean, reason?: string}}
 */
function validateTranscriptPath(transcriptPath) {
  if (!transcriptPath || typeof transcriptPath !== 'string') {
    return { valid: false, reason: 'Transcript path is empty' };
  }

  const resolved = path.resolve(transcriptPath);

  // Claude Code transcripts should be in ~/.claude or similar
  const allowedPrefixes = [
    path.join(os.homedir(), '.claude'),
    path.join(os.homedir(), '.config', 'claude'),
    '/tmp', // Temporary transcripts
  ];

  // Check it's in an allowed location
  const isAllowed = allowedPrefixes.some((prefix) =>
    resolved.startsWith(prefix),
  );
  if (!isAllowed) {
    return {
      valid: false,
      reason: 'Transcript path is outside expected directories',
    };
  }

  // Must end with expected extension
  if (!resolved.endsWith('.jsonl') && !resolved.endsWith('.json')) {
    return { valid: false, reason: 'Transcript must be a JSON/JSONL file' };
  }

  return { valid: true };
}

// ============================================================================
// CONTENT SANITIZATION
// ============================================================================

/**
 * Redact sensitive data from content before sending to API
 * @param {string} content - The content to sanitize
 * @returns {string}
 */
function redactSensitiveData(content) {
  if (!content || typeof content !== 'string') {
    return '';
  }

  let sanitized = content;

  for (const pattern of SENSITIVE_PATTERNS) {
    sanitized = sanitized.replace(pattern, '[REDACTED]');
  }

  return sanitized;
}

/**
 * Sanitize content for safe transmission
 * @param {string} content - The content to sanitize
 * @param {number} maxLength - Maximum allowed length
 * @returns {{content: string, truncated: boolean, redacted: boolean}}
 */
function sanitizeContent(content, maxLength = MAX_CONTENT_LENGTH) {
  if (!content || typeof content !== 'string') {
    return { content: '', truncated: false, redacted: false };
  }

  // Check original length
  const originalLength = content.length;
  const truncated = originalLength > maxLength;

  // Truncate if needed
  let sanitized = truncated ? content.slice(0, maxLength) : content;

  // Redact sensitive data
  const beforeRedact = sanitized;
  sanitized = redactSensitiveData(sanitized);
  const redacted = sanitized !== beforeRedact;

  // Remove control characters except newlines and tabs
  sanitized = sanitized.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

  return { content: sanitized, truncated, redacted };
}

/**
 * Sanitize a search query
 * @param {string} query
 * @returns {string}
 */
function sanitizeQuery(query) {
  if (!query || typeof query !== 'string') {
    return '';
  }

  // Truncate
  let sanitized = query.slice(0, MAX_QUERY_LENGTH);

  // Remove control characters
  sanitized = sanitized.replace(/[\x00-\x1F\x7F]/g, ' ');

  // Collapse whitespace
  sanitized = sanitized.replace(/\s+/g, ' ').trim();

  return sanitized;
}

/**
 * Sanitize metadata object
 * @param {object} metadata
 * @returns {object}
 */
function sanitizeMetadata(metadata) {
  if (!metadata || typeof metadata !== 'object') {
    return {};
  }

  const sanitized = {};
  let totalSize = 0;

  for (const [key, value] of Object.entries(metadata)) {
    // Skip if we've exceeded size limit
    if (totalSize > MAX_METADATA_SIZE) break;

    // Validate key
    if (typeof key !== 'string' || key.length > 100) continue;
    if (!/^[\w.-]+$/.test(key)) continue;

    // Sanitize value
    if (typeof value === 'string') {
      const sanitizedValue = redactSensitiveData(value).slice(0, 1000);
      sanitized[key] = sanitizedValue;
      totalSize += key.length + sanitizedValue.length;
    } else if (typeof value === 'number' && Number.isFinite(value)) {
      sanitized[key] = value;
      totalSize += key.length + 20;
    } else if (typeof value === 'boolean') {
      sanitized[key] = value;
      totalSize += key.length + 5;
    }
  }

  return sanitized;
}

// ============================================================================
// INPUT VALIDATION
// ============================================================================

/**
 * Validate stdin input size
 * @param {string} data - The raw stdin data
 * @returns {{valid: boolean, reason?: string}}
 */
function validateStdinSize(data) {
  if (!data) {
    return { valid: true };
  }

  if (data.length > MAX_STDIN_SIZE) {
    return {
      valid: false,
      reason: `Input exceeds maximum size (${MAX_STDIN_SIZE} bytes)`,
    };
  }

  return { valid: true };
}

/**
 * Validate and sanitize stdin JSON input
 * @param {object} input - Parsed stdin input
 * @returns {{valid: boolean, sanitized?: object, reason?: string}}
 */
function validateStdinInput(input) {
  if (!input || typeof input !== 'object') {
    return { valid: true, sanitized: {} };
  }

  const sanitized = {};

  // Validate session_id
  if (input.session_id) {
    if (typeof input.session_id !== 'string') {
      return { valid: false, reason: 'session_id must be a string' };
    }
    // Only allow alphanumeric, hyphen, underscore
    if (!/^[a-zA-Z0-9_-]+$/.test(input.session_id)) {
      return { valid: false, reason: 'session_id contains invalid characters' };
    }
    if (input.session_id.length > 100) {
      return { valid: false, reason: 'session_id is too long' };
    }
    sanitized.session_id = input.session_id;
  }

  // Validate cwd
  if (input.cwd) {
    if (typeof input.cwd !== 'string') {
      return { valid: false, reason: 'cwd must be a string' };
    }
    if (!path.isAbsolute(input.cwd)) {
      return { valid: false, reason: 'cwd must be an absolute path' };
    }
    try {
      const stats = fs.statSync(input.cwd);
      if (!stats.isDirectory()) {
        return { valid: false, reason: 'cwd is not a directory' };
      }
    } catch {
      return { valid: false, reason: 'cwd does not exist' };
    }
    sanitized.cwd = input.cwd;
  }

  // Validate transcript_path
  if (input.transcript_path) {
    const pathValidation = validateTranscriptPath(input.transcript_path);
    if (!pathValidation.valid) {
      return { valid: false, reason: pathValidation.reason };
    }
    sanitized.transcript_path = input.transcript_path;
  }

  // Validate tool_name
  if (input.tool_name) {
    if (typeof input.tool_name !== 'string') {
      return { valid: false, reason: 'tool_name must be a string' };
    }
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(input.tool_name)) {
      return { valid: false, reason: 'tool_name contains invalid characters' };
    }
    if (input.tool_name.length > 50) {
      return { valid: false, reason: 'tool_name is too long' };
    }
    sanitized.tool_name = input.tool_name;
  }

  return { valid: true, sanitized };
}

// ============================================================================
// AUDIT LOGGING
// ============================================================================

/**
 * Log security-relevant events (to stderr to avoid polluting stdout)
 * @param {string} event - Event type
 * @param {object} details - Event details
 */
function auditLog(event, details = {}) {
  if (process.env.SUPERMEMORY_AUDIT_LOG !== 'true') {
    return;
  }

  const entry = {
    timestamp: new Date().toISOString(),
    event,
    pid: process.pid,
    ...details,
  };

  console.error(`[AUDIT] ${JSON.stringify(entry)}`);
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  // URL validation
  validateApiUrl,
  getSecureApiUrl,
  getSecureAuthUrl,
  ALLOWED_API_HOSTS,

  // Path validation
  validateFilePath,
  validateTranscriptPath,

  // Content sanitization
  redactSensitiveData,
  sanitizeContent,
  sanitizeQuery,
  sanitizeMetadata,

  // Input validation
  validateStdinSize,
  validateStdinInput,

  // Audit logging
  auditLog,

  // Constants (exported for testing)
  MAX_STDIN_SIZE,
  MAX_CONTENT_LENGTH,
  MAX_QUERY_LENGTH,
  SENSITIVE_PATTERNS,
};
