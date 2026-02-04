#!/usr/bin/env node
/**
 * Supermemory-compatible local backend server
 *
 * A self-hosted replacement for the Supermemory API.
 * Connects to a Dockerized ChromaDB for vector storage.
 *
 * No data is sent to any external servers.
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
const CHROMA_URL = process.env.CHROMA_URL || 'http://127.0.0.1:8000';
const DATA_DIR = path.join(os.homedir(), '.supermemory-local');
const AUTH_TOKEN_FILE = path.join(DATA_DIR, 'auth.token');

// Allowed CORS origins - localhost only for security
const ALLOWED_ORIGINS = [
  'http://localhost',
  'http://127.0.0.1',
];

/**
 * Check if origin is allowed for CORS
 * Allows localhost/127.0.0.1 on any port
 */
function isAllowedOrigin(origin) {
  if (!origin) return true; // Allow requests with no origin (same-origin, curl, etc.)
  try {
    const url = new URL(origin);
    return url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  } catch {
    return false;
  }
}

/**
 * Get CORS origin header value
 * Returns the origin if allowed, null otherwise
 */
function getCorsOrigin(origin) {
  if (!origin) return null;
  return isAllowedOrigin(origin) ? origin : null;
}

// ============================================================================
// DATA DIRECTORY SETUP
// ============================================================================

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  }
}

// ============================================================================
// AUTHENTICATION
// ============================================================================

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
 * @param {http.IncomingMessage} req
 * @returns {boolean}
 */
function validateAuth(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader) return false;

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') {
    return false;
  }

  return parts[1] === authToken;
}

// ============================================================================
// CHROMADB CLIENT
// ============================================================================

class ChromaClient {
  constructor(baseUrl) {
    this.baseUrl = baseUrl;
  }

  async request(method, path, body = null) {
    const url = `${this.baseUrl}${path}`;
    const options = {
      method,
      headers: { 'Content-Type': 'application/json' },
    };
    if (body) {
      options.body = JSON.stringify(body);
    }

    const res = await fetch(url, options);
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`ChromaDB error: ${res.status} ${text}`);
    }
    return res.json();
  }

  async ensureCollection(name) {
    try {
      await this.request('POST', '/api/v1/collections', {
        name,
        metadata: { 'hnsw:space': 'cosine' },
        get_or_create: true,
      });
    } catch (err) {
      // Collection might already exist
      console.error('Collection setup:', err.message);
    }
  }

  async add(collection, documents, metadatas, ids) {
    // ChromaDB will generate embeddings if we use the default embedding function
    // For simplicity, we'll use the collection's add endpoint
    return this.request('POST', `/api/v1/collections/${collection}/add`, {
      documents,
      metadatas,
      ids,
    });
  }

  async query(collection, queryTexts, nResults = 10) {
    return this.request('POST', `/api/v1/collections/${collection}/query`, {
      query_texts: queryTexts,
      n_results: nResults,
      include: ['documents', 'metadatas', 'distances'],
    });
  }

  async get(collection, ids = null, where = null, limit = 20) {
    const body = { include: ['documents', 'metadatas'] };
    if (ids) body.ids = ids;
    if (where) body.where = where;
    if (limit) body.limit = limit;
    return this.request('POST', `/api/v1/collections/${collection}/get`, body);
  }

  async delete(collection, ids) {
    return this.request('POST', `/api/v1/collections/${collection}/delete`, {
      ids,
    });
  }

  async count(collection) {
    return this.request('GET', `/api/v1/collections/${collection}/count`);
  }
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

function sanitizeCollectionName(tag) {
  // ChromaDB collection names must be alphanumeric with underscores
  return tag.replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 63);
}

// ============================================================================
// API HANDLERS
// ============================================================================

async function handleAdd(chroma, body) {
  const { content, containerTag, metadata, customId } = body;

  if (!content) {
    return { error: 'content is required', status: 400 };
  }

  const collection = sanitizeCollectionName(containerTag || 'default');
  await chroma.ensureCollection(collection);

  const id = customId || generateId();
  const title = extractTitle(content);

  const meta = {
    ...(metadata || {}),
    title: title || '',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  await chroma.add(collection, [content], [meta], [id]);

  return { id, status: 'ok' };
}

async function handleProfile(chroma, body) {
  const { containerTag, q } = body;

  if (!containerTag) {
    return { error: 'containerTag is required', status: 400 };
  }

  const collection = sanitizeCollectionName(containerTag);

  // Get recent memories for profile generation
  let staticFacts = [];
  let dynamicFacts = [];

  try {
    const recent = await chroma.get(collection, null, null, 50);
    if (recent.documents && recent.documents.length > 0) {
      // Extract facts from content
      const allContent = recent.documents.join('\n');

      // Simple fact extraction
      const staticPatterns = [
        /(?:prefers?|likes?|uses?|wants?)\s+(.{5,50}?)(?:\.|,|$)/gi,
      ];
      const dynamicPatterns = [
        /(?:working on|implementing|building)\s+(.{5,50}?)(?:\.|,|$)/gi,
      ];

      for (const pattern of staticPatterns) {
        const matches = allContent.matchAll(pattern);
        for (const match of matches) {
          if (match[1] && staticFacts.length < 10) {
            staticFacts.push(match[1].trim());
          }
        }
      }

      for (const pattern of dynamicPatterns) {
        const matches = allContent.matchAll(pattern);
        for (const match of matches) {
          if (match[1] && dynamicFacts.length < 10) {
            dynamicFacts.push(match[1].trim());
          }
        }
      }
    }
  } catch (err) {
    console.error('Profile generation error:', err.message);
  }

  let searchResults;
  if (q) {
    try {
      const results = await chroma.query(collection, [q], 5);
      searchResults = {
        results: (results.documents?.[0] || []).map((doc, i) => ({
          id: results.ids?.[0]?.[i] || generateId(),
          content: doc,
          memory: doc,
          similarity: 1 - (results.distances?.[0]?.[i] || 0),
          title: results.metadatas?.[0]?.[i]?.title || null,
        })),
        total: results.documents?.[0]?.length || 0,
        timing: 0,
      };
    } catch (err) {
      console.error('Search error:', err.message);
    }
  }

  return {
    profile: { static: staticFacts, dynamic: dynamicFacts },
    searchResults,
  };
}

async function handleSearchMemories(chroma, body) {
  const { q, containerTag, limit = 10 } = body;

  if (!q) {
    return { error: 'q is required', status: 400 };
  }

  const collection = sanitizeCollectionName(containerTag || 'default');
  const startTime = Date.now();

  try {
    const results = await chroma.query(collection, [q], Math.min(limit, 50));

    return {
      results: (results.documents?.[0] || []).map((doc, i) => ({
        id: results.ids?.[0]?.[i] || generateId(),
        content: doc,
        memory: doc,
        similarity: 1 - (results.distances?.[0]?.[i] || 0),
        title: results.metadatas?.[0]?.[i]?.title || null,
        metadata: results.metadatas?.[0]?.[i] || null,
      })),
      total: results.documents?.[0]?.length || 0,
      timing: Date.now() - startTime,
    };
  } catch (err) {
    console.error('Search error:', err.message);
    return { results: [], total: 0, timing: Date.now() - startTime };
  }
}

async function handleListMemories(chroma, body) {
  const { containerTags, limit = 20 } = body;

  const tag = Array.isArray(containerTags) ? containerTags[0] : containerTags;
  const collection = sanitizeCollectionName(tag || 'default');

  try {
    const results = await chroma.get(collection, null, null, limit);

    return {
      memories: (results.documents || []).map((doc, i) => ({
        id: results.ids?.[i] || generateId(),
        content: doc,
        title: results.metadatas?.[i]?.title || null,
        metadata: results.metadatas?.[i] || null,
        createdAt: results.metadatas?.[i]?.created_at || null,
        updatedAt: results.metadatas?.[i]?.updated_at || null,
      })),
    };
  } catch (err) {
    console.error('List error:', err.message);
    return { memories: [] };
  }
}

async function handleDeleteMemory(chroma, id, containerTag) {
  const collection = sanitizeCollectionName(containerTag || 'default');

  try {
    await chroma.delete(collection, [id]);
    return { status: 'ok' };
  } catch (err) {
    console.error('Delete error:', err.message);
    return { error: 'Memory not found', status: 404 };
  }
}

// ============================================================================
// HTTP SERVER
// ============================================================================

async function parseBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => {
      data += chunk;
      if (data.length > 10 * 1024 * 1024) {
        reject(new Error('Request body too large'));
      }
    });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (err) {
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

async function handleRequest(chroma, req, res) {
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
        'Vary': 'Origin',
      });
    } else {
      res.writeHead(403);
    }
    res.end();
    return;
  }

  // Route handling - support both /v1 prefix and root paths
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
      result = await handleAdd(chroma, body);
    } else if (routePath === '/profile' && method === 'POST') {
      const body = await parseBody(req);
      result = await handleProfile(chroma, body);
    } else if (routePath === '/search/memories' && method === 'POST') {
      const body = await parseBody(req);
      result = await handleSearchMemories(chroma, body);
    } else if (routePath === '/memories/list' && method === 'POST') {
      const body = await parseBody(req);
      result = await handleListMemories(chroma, body);
    } else if (routePath.startsWith('/memories/') && method === 'DELETE') {
      const id = routePath.split('/').pop();
      const body = await parseBody(req).catch(() => ({}));
      result = await handleDeleteMemory(chroma, id, body.containerTag);
    } else if (isHealthCheck) {
      result = { status: 'ok', version: '1.0.0', storage: 'chromadb' };
    } else {
      sendError(res, 'Not found', 404);
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

async function main() {
  console.log('Supermemory Local Backend (Docker + ChromaDB)');
  console.log('==============================================');
  console.log(`ChromaDB URL: ${CHROMA_URL}`);
  console.log(`API Port: ${PORT}`);

  ensureDataDir();

  // Load or create auth token
  authToken = loadOrCreateAuthToken();
  console.log(`Auth token file: ${AUTH_TOKEN_FILE}`);
  console.log(`Auth token: ${authToken}`);

  const chroma = new ChromaClient(CHROMA_URL);

  // Test connection
  try {
    await fetch(`${CHROMA_URL}/api/v1/heartbeat`);
    console.log('ChromaDB connection: OK');
  } catch (err) {
    console.error('');
    console.error('ERROR: Cannot connect to ChromaDB');
    console.error('Make sure Docker is running with:');
    console.error('  docker compose up -d');
    console.error('');
    process.exit(1);
  }

  const server = http.createServer((req, res) => {
    handleRequest(chroma, req, res);
  });

  server.listen(PORT, '127.0.0.1', () => {
    console.log('');
    console.log(`Server running at http://127.0.0.1:${PORT}`);
    console.log('');
    console.log('To use with the plugin, set:');
    console.log(`  export SUPERMEMORY_API_URL=http://127.0.0.1:${PORT}`);
    console.log('  export SUPERMEMORY_CC_API_KEY=local_ignored');
  });

  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log('\nShutting down...');
    server.close();
    process.exit(0);
  });
}

main();
