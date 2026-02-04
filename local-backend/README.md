# Supermemory Local Backend

A self-hosted, privacy-focused replacement for the Supermemory API.

**All data stays on your machine. Nothing is sent to external servers.**

## Features

- **Zero dependencies** - Just Node.js, no Docker required
- **JSON storage** - Simple, portable data format
- **TF-IDF search** - Built-in keyword search
- **Authentication** - Bearer token required for all API calls
- **Secure by default** - Localhost only, restrictive file permissions

## Quick Start

```bash
# Start the server
npm start

# The auth token is displayed on first run
# It's also saved to ~/.supermemory-local/auth.token
```

Output:
```
Supermemory Local Backend
=========================
Data directory: /Users/you/.supermemory-local
Database: /Users/you/.supermemory-local/memories.json
Auth token file: /Users/you/.supermemory-local/auth.token
Auth token: abc123...

Loaded 0 memories

Server running at http://127.0.0.1:19877
```

## Configuration

Configure the plugin to use the local backend:

```bash
export SUPERMEMORY_API_URL=http://127.0.0.1:19877
export SUPERMEMORY_CC_API_KEY=local_ignored
```

The client automatically loads the auth token from `~/.supermemory-local/auth.token`.

## Data Storage

All data is stored in `~/.supermemory-local/`:

| File | Description | Permissions |
|------|-------------|-------------|
| `memories.json` | All memories and metadata | 0600 |
| `auth.token` | Authentication token | 0600 |

### Backup

```bash
cp ~/.supermemory-local/memories.json ~/backup/
```

### Restore

```bash
cp ~/backup/memories.json ~/.supermemory-local/
```

### Reset

```bash
rm ~/.supermemory-local/memories.json
# Restart the server
```

## API Endpoints

All endpoints except `/health` require authentication:
```
Authorization: Bearer <token>
```

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/add` | POST | Add a memory |
| `/profile` | POST | Get user profile with extracted facts |
| `/search/memories` | POST | Search memories (TF-IDF) |
| `/memories/list` | POST | List memories |
| `/memories/:id` | DELETE | Soft-delete a memory |
| `/health` | GET | Health check (no auth required) |

### Example: Add Memory

```bash
curl -X POST http://127.0.0.1:19877/add \
  -H "Authorization: Bearer $(cat ~/.supermemory-local/auth.token)" \
  -H "Content-Type: application/json" \
  -d '{"content": "User prefers TypeScript", "containerTag": "my-project"}'
```

### Example: Search

```bash
curl -X POST http://127.0.0.1:19877/search/memories \
  -H "Authorization: Bearer $(cat ~/.supermemory-local/auth.token)" \
  -H "Content-Type: application/json" \
  -d '{"q": "TypeScript", "containerTag": "my-project"}'
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `SUPERMEMORY_LOCAL_PORT` | `19877` | API server port |

## Security

### Authentication

- 32-byte random token generated on first run
- Token stored in `~/.supermemory-local/auth.token` with 0600 permissions
- All API calls (except `/health`) require `Authorization: Bearer <token>`
- Timing-safe token comparison prevents timing attacks

### CORS

- Only `localhost` and `127.0.0.1` origins allowed
- Requests from other origins are rejected with 403

### Network

- Server binds to `127.0.0.1` only (not accessible from network)
- Request body size limited to 10MB

### Data

- All files created with 0600 permissions (owner read/write only)
- Data directory created with 0700 permissions
- Soft deletes preserve data integrity

## Search Algorithm

The backend uses TF-IDF-like keyword matching:

1. Query and documents are tokenized (lowercase, remove punctuation, min 3 chars)
2. Score = (matching tokens) / (query tokens)
3. Results sorted by score, normalized to 0-1 similarity

For semantic/vector search, use the Supermemory cloud service.

## Comparison to Supermemory Cloud

| Feature | Local | Cloud |
|---------|-------|-------|
| Data privacy | 100% local | Stored on their servers |
| Search | TF-IDF keyword | Semantic/vector |
| Cost | Free | Pro subscription |
| Setup | `npm start` | None |
| Profile generation | Pattern extraction | AI-powered |
| Authentication | Bearer token | API key |

## Troubleshooting

### "Unauthorized" error

Make sure you're including the auth token:
```bash
curl -H "Authorization: Bearer $(cat ~/.supermemory-local/auth.token)" ...
```

### Port already in use

```bash
# Check what's using port 19877
lsof -i :19877

# Use a different port
SUPERMEMORY_LOCAL_PORT=19878 npm start
```

### Permission denied

```bash
# Fix permissions
chmod 700 ~/.supermemory-local
chmod 600 ~/.supermemory-local/*
```

### View stored data

```bash
cat ~/.supermemory-local/memories.json | jq
```
