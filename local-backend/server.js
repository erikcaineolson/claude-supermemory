#!/usr/bin/env node
/**
 * Supermemory-compatible local backend server
 *
 * A self-hosted replacement for the Supermemory API that stores all data locally.
 * No Docker required - uses JSON file storage with TF-IDF search.
 *
 * Storage: ~/.supermemory-local/memories.json
 * Auth: Bearer token stored in ~/.supermemory-local/auth.token
 */

import http from 'node:http';
import { URL } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import crypto from 'node:crypto';

// ============================================================================
// CONFIGURATION
// ============================================================================

const PORT = process.env.SUPERMEMORY_LOCAL_PORT || 19877;
const DATA_DIR = path.join(os.homedir(), '.supermemory-local');
const DB_FILE = path.join(DATA_DIR, 'memories.json');
const AUTH_TOKEN_FILE = path.join(DATA_DIR, 'auth.token');

// ============================================================================
// DATA DIRECTORY & AUTH
// ============================================================================

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  }
}

let authToken = null;

/**
 * Generate a secure random token
 */
function generateAuthToken() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Load or create auth token
 * Token is saved to ~/.supermemory-local/auth.token with mode 0600
 */
function loadOrCreateAuthToken() {
  try {
    if (fs.existsSync(AUTH_TOKEN_FILE)) {
      const token = fs.readFileSync(AUTH_TOKEN_FILE, 'utf-8').trim();
      if (token.length >= 32) {
        return token;
      }
    }
  } catch (err) {
    console.error('Failed to read auth token:', err.message);
  }

  // Generate new token
  const token = generateAuthToken();
  try {
    fs.writeFileSync(AUTH_TOKEN_FILE, token, { mode: 0o600 });
  } catch (err) {
    console.error('Failed to save auth token:', err.message);
  }
  return token;
}

/**
 * Validate authorization header
 * Uses timing-safe comparison to prevent timing attacks
 */
function validateAuth(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader) return false;

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') {
    return false;
  }

  const providedToken = parts[1];
  if (providedToken.length !== authToken.length) {
    return false;
  }

  // Use timing-safe comparison to prevent timing attacks
  return crypto.timingSafeEqual(
    Buffer.from(providedToken),
    Buffer.from(authToken),
  );
}

// ============================================================================
// CORS - Localhost only
// ============================================================================

/**
 * Check if origin is allowed for CORS
 * Only allows localhost/127.0.0.1 on any port
 */
function isAllowedOrigin(origin) {
  if (!origin) return true;
  try {
    const url = new URL(origin);
    return url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  } catch {
    return false;
  }
}

function getCorsOrigin(origin) {
  if (!origin) return null;
  return isAllowedOrigin(origin) ? origin : null;
}

// ============================================================================
// JSON DATABASE
// ============================================================================

function loadDb() {
  ensureDataDir();
  if (fs.existsSync(DB_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
    } catch {
      return { memories: {}, profiles: {} };
    }
  }
  return { memories: {}, profiles: {} };
}

function saveDb(db) {
  ensureDataDir();
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), { mode: 0o600 });
}

// ============================================================================
// TEXT SEARCH (TF-IDF-like scoring)
// ============================================================================

function tokenize(text) {
  if (!text) return [];
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 2);
}

function calculateScore(queryTokens, docTokens) {
  if (queryTokens.length === 0 || docTokens.length === 0) return 0;

  const docSet = new Set(docTokens);
  let matches = 0;

  for (const token of queryTokens) {
    if (docSet.has(token)) matches++;
  }

  return matches / queryTokens.length;
}

function searchMemories(db, containerTag, query, limit = 10) {
  const startTime = Date.now();
  const memories = db.memories[containerTag] || [];

  if (memories.length === 0) {
    return { results: [], total: 0, timing: Date.now() - startTime };
  }

  const queryTokens = tokenize(query);

  // Single-pass scoring to reduce intermediate arrays
  const scored = [];
  for (const m of memories) {
    if (m.deleted) continue;
    const score = calculateScore(queryTokens, tokenize(m.content));
    if (score > 0) {
      scored.push({ ...m, score });
    }
  }

  // Sort and limit
  scored.sort((a, b) => b.score - a.score);
  const topResults = scored.slice(0, limit);

  const maxScore = topResults.length > 0 ? topResults[0].score : 1;

  return {
    results: topResults.map((m) => ({
      id: m.id,
      content: m.content,
      memory: m.content,
      title: m.title,
      similarity: m.score / maxScore,
      metadata: m.metadata,
      createdAt: m.createdAt,
      updatedAt: m.updatedAt,
    })),
    total: scored.length,
    timing: Date.now() - startTime,
  };
}

// ============================================================================
// PROFILE GENERATION
// ============================================================================

// Pre-compiled regex patterns (cached at module load)
const STATIC_PATTERNS = [
  /(?:prefers?|likes?|uses?|wants?)\s+(.{5,60}?)(?:\.|,|$)/gi,
  /(?:always|usually|typically)\s+(.{5,60}?)(?:\.|,|$)/gi,
];

const DYNAMIC_PATTERNS = [
  /(?:working on|implementing|building|fixing)\s+(.{5,60}?)(?:\.|,|$)/gi,
  /(?:just|recently|currently)\s+(.{5,60}?)(?:\.|,|$)/gi,
];

function generateProfile(db, containerTag) {
  const memories = db.memories[containerTag] || [];
  const recent = memories.filter((m) => !m.deleted).slice(-50);

  if (recent.length === 0) {
    return { static: [], dynamic: [] };
  }

  const staticFacts = new Set();
  const dynamicFacts = new Set();

  for (const mem of recent) {
    for (const pattern of STATIC_PATTERNS) {
      // Reset lastIndex for global regex reuse
      pattern.lastIndex = 0;
      for (const match of mem.content.matchAll(pattern)) {
        if (match[1] && staticFacts.size < 10) staticFacts.add(match[1].trim());
      }
    }
    for (const pattern of DYNAMIC_PATTERNS) {
      pattern.lastIndex = 0;
      for (const match of mem.content.matchAll(pattern)) {
        if (match[1] && dynamicFacts.size < 10)
          dynamicFacts.add(match[1].trim());
      }
    }
  }

  return {
    static: Array.from(staticFacts),
    dynamic: Array.from(dynamicFacts),
  };
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function generateId() {
  return crypto.randomUUID();
}

function extractTitle(content, maxLength = 100) {
  if (!content) return null;
  const firstLine = content.split('\n')[0].trim();
  if (firstLine.length <= maxLength) return firstLine;
  return firstLine.slice(0, maxLength) + '...';
}

// ============================================================================
// API HANDLERS
// ============================================================================

async function handleAdd(db, body) {
  const { content, containerTag, metadata, customId } = body;

  if (!content) {
    return { error: 'content is required', status: 400 };
  }

  const tag = containerTag || 'default';
  if (!db.memories[tag]) {
    db.memories[tag] = [];
  }

  const id = customId || generateId();
  const now = new Date().toISOString();

  db.memories[tag].push({
    id,
    content,
    title: extractTitle(content),
    metadata: metadata || {},
    createdAt: now,
    updatedAt: now,
    deleted: false,
  });

  saveDb(db);
  return { id, status: 'ok' };
}

async function handleProfile(db, body) {
  const { containerTag, q } = body;

  if (!containerTag) {
    return { error: 'containerTag is required', status: 400 };
  }

  const profile = generateProfile(db, containerTag);

  let searchResults;
  if (q) {
    searchResults = searchMemories(db, containerTag, q, 5);
  }

  return { profile, searchResults };
}

async function handleSearchMemories(db, body) {
  const { q, containerTag, limit = 10 } = body;

  if (!q) {
    return { error: 'q is required', status: 400 };
  }

  return searchMemories(db, containerTag || 'default', q, Math.min(limit, 50));
}

async function handleListMemories(db, body) {
  const { containerTags, limit = 20 } = body;

  const tag = Array.isArray(containerTags)
    ? containerTags[0]
    : containerTags || 'default';
  const memories = (db.memories[tag] || [])
    .filter((m) => !m.deleted)
    .slice(-limit)
    .reverse();

  return {
    memories: memories.map((m) => ({
      id: m.id,
      content: m.content,
      title: m.title,
      metadata: m.metadata,
      createdAt: m.createdAt,
      updatedAt: m.updatedAt,
    })),
  };
}

async function handleDeleteMemory(db, id) {
  for (const tag of Object.keys(db.memories)) {
    const mem = db.memories[tag].find((m) => m.id === id);
    if (mem) {
      mem.deleted = true;
      mem.updatedAt = new Date().toISOString();
      saveDb(db);
      return { status: 'ok' };
    }
  }
  return { error: 'Memory not found', status: 404 };
}

// ============================================================================
// HTTP SERVER
// ============================================================================

async function parseBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 2 * 1024 * 1024) {
        reject(new Error('Request body too large (max 2MB)'));
      }
    });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, data, statusCode = 200, origin = null) {
  const headers = {
    'Content-Type': 'application/json',
  };
  const corsOrigin = getCorsOrigin(origin);
  if (corsOrigin) {
    headers['Access-Control-Allow-Origin'] = corsOrigin;
    headers['Vary'] = 'Origin';
  }
  res.writeHead(statusCode, headers);
  res.end(JSON.stringify(data));
}

function sendError(res, message, statusCode = 400, origin = null) {
  sendJson(res, { error: message }, statusCode, origin);
}

async function handleRequest(db, req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = url.pathname;
  const method = req.method;
  const origin = req.headers.origin;

  // CORS preflight
  if (method === 'OPTIONS') {
    const corsOrigin = getCorsOrigin(origin);
    if (corsOrigin) {
      res.writeHead(200, {
        'Access-Control-Allow-Origin': corsOrigin,
        'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Max-Age': '86400',
        Vary: 'Origin',
      });
    } else {
      res.writeHead(403);
    }
    res.end();
    return;
  }

  // Route handling
  const routePath = pathname.replace(/^\/v1/, '');

  // Health endpoint doesn't require auth
  const isHealthCheck = routePath === '/health' || pathname === '/health';

  // Validate auth for non-health endpoints
  if (!isHealthCheck && !validateAuth(req)) {
    sendError(res, 'Unauthorized - Bearer token required', 401, origin);
    return;
  }

  try {
    let result;

    if ((routePath === '/add' || routePath === '/') && method === 'POST') {
      const body = await parseBody(req);
      result = await handleAdd(db, body);
    } else if (routePath === '/profile' && method === 'POST') {
      const body = await parseBody(req);
      result = await handleProfile(db, body);
    } else if (routePath === '/search/memories' && method === 'POST') {
      const body = await parseBody(req);
      result = await handleSearchMemories(db, body);
    } else if (routePath === '/memories/list' && method === 'POST') {
      const body = await parseBody(req);
      result = await handleListMemories(db, body);
    } else if (routePath.startsWith('/memories/') && method === 'DELETE') {
      const id = routePath.split('/').pop();
      result = await handleDeleteMemory(db, id);
    } else if (isHealthCheck) {
      const memCount = Object.values(db.memories)
        .flat()
        .filter((m) => !m.deleted).length;
      result = {
        status: 'ok',
        version: '1.0.0',
        storage: 'json',
        memories: memCount,
      };
    } else {
      sendError(res, 'Not found', 404, origin);
      return;
    }

    if (result.error) {
      sendError(res, result.error, result.status || 400, origin);
    } else {
      sendJson(res, result, 200, origin);
    }
  } catch (err) {
    console.error('Request error:', err);
    sendError(res, err.message, 500, origin);
  }
}

// ============================================================================
// MAIN
// ============================================================================

function main() {
  console.log('Supermemory Local Backend');
  console.log('=========================');
  console.log(`Data directory: ${DATA_DIR}`);
  console.log(`Database: ${DB_FILE}`);

  ensureDataDir();

  // Load or create auth token
  authToken = loadOrCreateAuthToken();
  console.log(`Auth token file: ${AUTH_TOKEN_FILE}`);
  // Mask token to prevent exposure in terminal logs
  const maskedToken = authToken.slice(0, 4) + '...' + authToken.slice(-4);
  console.log(`Auth token: ${maskedToken} (full token in ${AUTH_TOKEN_FILE})`);
  console.log('');

  const db = loadDb();
  const memCount = Object.values(db.memories)
    .flat()
    .filter((m) => !m.deleted).length;
  console.log(`Loaded ${memCount} memories`);

  const server = http.createServer((req, res) => {
    handleRequest(db, req, res);
  });

  server.listen(PORT, '127.0.0.1', () => {
    console.log('');
    console.log(`Server running at http://127.0.0.1:${PORT}`);
    console.log('');
    console.log('To use with the plugin:');
    console.log(`  export SUPERMEMORY_API_URL=http://127.0.0.1:${PORT}`);
    console.log('  export SUPERMEMORY_CC_API_KEY=local_ignored');
  });

  process.on('SIGINT', () => {
    console.log('\nShutting down...');
    server.close();
    process.exit(0);
  });
}

main();
