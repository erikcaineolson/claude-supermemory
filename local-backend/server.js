#!/usr/bin/env node
/**
 * Supermemory-compatible local backend server
 *
 * A self-hosted replacement for the Supermemory API that stores all data locally.
 * No Docker required - uses SQLite for storage.
 *
 * Storage: ~/.supermemory-local/memories.db
 * Search: TF-IDF keyword search
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

// ============================================================================
// SIMPLE JSON DATABASE
// ============================================================================

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  }
}

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
    .filter(t => t.length > 2);
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
  const scored = memories
    .filter(m => !m.deleted)
    .map(m => ({
      ...m,
      score: calculateScore(queryTokens, tokenize(m.content)),
    }))
    .filter(m => m.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  const maxScore = scored.length > 0 ? scored[0].score : 1;

  return {
    results: scored.map(m => ({
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

function generateProfile(db, containerTag) {
  const memories = db.memories[containerTag] || [];
  const recent = memories.filter(m => !m.deleted).slice(-50);

  if (recent.length === 0) {
    return { static: [], dynamic: [] };
  }

  const staticPatterns = [
    /(?:prefers?|likes?|uses?|wants?)\s+(.{5,60}?)(?:\.|,|$)/gi,
    /(?:always|usually|typically)\s+(.{5,60}?)(?:\.|,|$)/gi,
  ];

  const dynamicPatterns = [
    /(?:working on|implementing|building|fixing)\s+(.{5,60}?)(?:\.|,|$)/gi,
    /(?:just|recently|currently)\s+(.{5,60}?)(?:\.|,|$)/gi,
  ];

  const staticFacts = new Set();
  const dynamicFacts = new Set();

  for (const mem of recent) {
    for (const pattern of staticPatterns) {
      for (const match of mem.content.matchAll(pattern)) {
        if (match[1] && staticFacts.size < 10) staticFacts.add(match[1].trim());
      }
    }
    for (const pattern of dynamicPatterns) {
      for (const match of mem.content.matchAll(pattern)) {
        if (match[1] && dynamicFacts.size < 10) dynamicFacts.add(match[1].trim());
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

  const tag = Array.isArray(containerTags) ? containerTags[0] : (containerTags || 'default');
  const memories = (db.memories[tag] || [])
    .filter(m => !m.deleted)
    .slice(-limit)
    .reverse();

  return {
    memories: memories.map(m => ({
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
    const mem = db.memories[tag].find(m => m.id === id);
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

function sendJson(res, data, statusCode = 200) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(JSON.stringify(data));
}

function sendError(res, message, statusCode = 400) {
  sendJson(res, { error: message }, statusCode);
}

async function handleRequest(db, req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = url.pathname;
  const method = req.method;

  // CORS preflight
  if (method === 'OPTIONS') {
    res.writeHead(200, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    });
    res.end();
    return;
  }

  try {
    let result;
    const path = pathname.replace(/^\/v1/, '');

    if ((path === '/add' || path === '/') && method === 'POST') {
      const body = await parseBody(req);
      result = await handleAdd(db, body);
    } else if (path === '/profile' && method === 'POST') {
      const body = await parseBody(req);
      result = await handleProfile(db, body);
    } else if (path === '/search/memories' && method === 'POST') {
      const body = await parseBody(req);
      result = await handleSearchMemories(db, body);
    } else if (path === '/memories/list' && method === 'POST') {
      const body = await parseBody(req);
      result = await handleListMemories(db, body);
    } else if (path.startsWith('/memories/') && method === 'DELETE') {
      const id = path.split('/').pop();
      result = await handleDeleteMemory(db, id);
    } else if (path === '/health' || pathname === '/health') {
      const memCount = Object.values(db.memories).flat().filter(m => !m.deleted).length;
      result = { status: 'ok', version: '1.0.0', storage: 'json', memories: memCount };
    } else {
      sendError(res, 'Not found', 404);
      return;
    }

    if (result.error) {
      sendError(res, result.error, result.status || 400);
    } else {
      sendJson(res, result);
    }
  } catch (err) {
    console.error('Request error:', err);
    sendError(res, err.message, 500);
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
  console.log('');

  const db = loadDb();
  const memCount = Object.values(db.memories).flat().filter(m => !m.deleted).length;
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
