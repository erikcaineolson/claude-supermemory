const { execFileSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function sha256(input) {
  return crypto.createHash('sha256').update(input).digest('hex').slice(0, 16);
}

/**
 * Validate that cwd is a safe directory path.
 * Prevents command injection via malicious directory paths.
 */
function validateCwd(cwd) {
  if (!cwd || typeof cwd !== 'string') {
    return false;
  }
  // Must be an absolute path
  if (!path.isAbsolute(cwd)) {
    return false;
  }
  // Must exist and be a directory
  try {
    const stats = fs.statSync(cwd);
    return stats.isDirectory();
  } catch {
    return false;
  }
}

// Cache git roots to avoid repeated executions
const gitRootCache = new Map();

function getGitRoot(cwd) {
  // Validate cwd before using it in shell command
  if (!validateCwd(cwd)) {
    return null;
  }

  // Return cached result if available
  if (gitRootCache.has(cwd)) {
    return gitRootCache.get(cwd);
  }

  try {
    // Use execFileSync instead of execSync to avoid shell interpretation
    const gitRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    const result = gitRoot || null;
    gitRootCache.set(cwd, result);
    return result;
  } catch {
    gitRootCache.set(cwd, null);
    return null;
  }
}

function getContainerTag(cwd) {
  const gitRoot = getGitRoot(cwd);
  const basePath = gitRoot || cwd;
  return `claudecode_project_${sha256(basePath)}`;
}

function getProjectName(cwd) {
  const gitRoot = getGitRoot(cwd);
  const basePath = gitRoot || cwd;
  return basePath.split('/').pop() || 'unknown';
}

function getUserContainerTag() {
  try {
    // Use execFileSync to avoid shell interpretation
    const email = execFileSync('git', ['config', 'user.email'], {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    if (email) return `claudecode_user_${sha256(email)}`;
  } catch {}
  const username = process.env.USER || process.env.USERNAME || 'anonymous';
  return `claudecode_user_${sha256(username)}`;
}

module.exports = {
  sha256,
  getGitRoot,
  getContainerTag,
  getProjectName,
  getUserContainerTag,
  validateCwd,
};
