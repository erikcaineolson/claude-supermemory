const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFile } = require('node:child_process');

const authSuccessHtml = require('../templates/auth-success.html');
const authErrorHtml = require('../templates/auth-error.html');
const { getSecureAuthUrl, auditLog } = require('./security');

const SETTINGS_DIR = path.join(os.homedir(), '.supermemory-claude');
const CREDENTIALS_FILE = path.join(SETTINGS_DIR, 'credentials.json');

// Use secure URL validation - rejects untrusted hosts
const AUTH_BASE_URL = getSecureAuthUrl();
const AUTH_PORT = 19876;
const AUTH_TIMEOUT = 25000;
const MAX_AUTH_REQUESTS = 10;

function ensureDir() {
  try {
    if (!fs.existsSync(SETTINGS_DIR)) {
      fs.mkdirSync(SETTINGS_DIR, { recursive: true, mode: 0o700 });
    }
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;
  }
}

function loadCredentials() {
  try {
    if (fs.existsSync(CREDENTIALS_FILE)) {
      const data = JSON.parse(fs.readFileSync(CREDENTIALS_FILE, 'utf-8'));
      if (data.apiKey) return data;
    }
  } catch {}
  return null;
}

function saveCredentials(apiKey) {
  ensureDir();
  const data = {
    apiKey,
    savedAt: new Date().toISOString(),
  };
  fs.writeFileSync(CREDENTIALS_FILE, JSON.stringify(data, null, 2), {
    mode: 0o600,
  });
  auditLog('credentials_saved', { file: CREDENTIALS_FILE });
}

function clearCredentials() {
  try {
    if (fs.existsSync(CREDENTIALS_FILE)) {
      fs.unlinkSync(CREDENTIALS_FILE);
    }
  } catch {}
}

function openBrowser(url) {
  const cmd =
    process.platform === 'darwin'
      ? 'open'
      : process.platform === 'win32'
        ? 'start'
        : 'xdg-open';
  // Use execFile to prevent command injection - URL passed as argument, not interpolated
  execFile(cmd, [url], (err) => {
    if (err) {
      console.error(`Failed to open browser: ${err.message}`);
    }
  });
}

function startAuthFlow() {
  return new Promise((resolve, reject) => {
    let resolved = false;
    let requestCount = 0;

    const server = http.createServer((req, res) => {
      requestCount++;

      // Rate limit: close server after too many requests
      if (requestCount > MAX_AUTH_REQUESTS) {
        auditLog('auth_rate_limit_exceeded', { requestCount });
        res.writeHead(429);
        res.end('Too many requests');
        if (!resolved) {
          resolved = true;
          server.close();
          reject(new Error('Too many auth requests'));
        }
        return;
      }

      const url = new URL(req.url, `http://localhost:${AUTH_PORT}`);

      if (url.pathname === '/callback') {
        const apiKey =
          url.searchParams.get('apikey') || url.searchParams.get('api_key');

        if (apiKey?.startsWith('sm_')) {
          auditLog('auth_success', { keyPrefix: apiKey.slice(0, 6) });
          saveCredentials(apiKey);
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(authSuccessHtml);
          resolved = true;
          server.close();
          resolve(apiKey);
        } else {
          auditLog('auth_invalid_key', {
            hasKey: !!apiKey,
            prefix: apiKey ? apiKey.slice(0, 3) : null,
          });
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end(authErrorHtml);
          // Close server after invalid auth attempt to prevent brute force
          if (!resolved) {
            resolved = true;
            server.close();
            reject(new Error('Invalid API key format'));
          }
        }
      } else {
        res.writeHead(404);
        res.end('Not found');
      }
    });

    server.listen(AUTH_PORT, '127.0.0.1', () => {
      const callbackUrl = `http://localhost:${AUTH_PORT}/callback`;
      const authUrl = `${AUTH_BASE_URL}?callback=${encodeURIComponent(callbackUrl)}&client=claude_code`;
      openBrowser(authUrl);
    });

    server.on('error', (err) => {
      if (!resolved) {
        resolved = true;
        reject(new Error(`Failed to start auth server: ${err.message}`));
      }
    });

    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        server.close();
        reject(new Error('AUTH_TIMEOUT'));
      }
    }, AUTH_TIMEOUT);
  });
}

module.exports = {
  CREDENTIALS_FILE,
  loadCredentials,
  saveCredentials,
  clearCredentials,
  startAuthFlow,
};
