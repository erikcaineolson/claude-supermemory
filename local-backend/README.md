# Supermemory Local Backend

A self-hosted, privacy-focused replacement for the Supermemory API.

**All data stays on your machine. No external network calls. No Docker required.**

## Quick Start

```bash
# Start the server
npm start

# Configure the plugin (add to ~/.zshrc or ~/.bashrc)
export SUPERMEMORY_API_URL=http://127.0.0.1:19877
export SUPERMEMORY_CC_API_KEY=local_ignored
```

That's it! The server stores everything in `~/.supermemory-local/memories.json`.

## Features

- **Zero dependencies** - Just Node.js 18+
- **Keyword search** - TF-IDF-based relevance scoring
- **Profile generation** - Extracts preferences and context from your memories
- **Soft deletes** - Data is never permanently lost

## Data Storage

- **Location**: `~/.supermemory-local/memories.json`
- **Format**: Human-readable JSON
- **Permissions**: 0600 (owner read/write only)

### Backup

```bash
cp ~/.supermemory-local/memories.json ~/backup/
```

### Reset

```bash
rm ~/.supermemory-local/memories.json
```

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/add` | POST | Add a memory |
| `/profile` | POST | Get user profile with facts |
| `/search/memories` | POST | Search memories |
| `/memories/list` | POST | List memories |
| `/memories/:id` | DELETE | Soft-delete a memory |
| `/health` | GET | Health check + memory count |

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `SUPERMEMORY_LOCAL_PORT` | `19877` | API server port |

## Security

- Server binds to `127.0.0.1` only (localhost)
- No network calls to external services
- No telemetry or analytics
- Data stored with restrictive file permissions

## Comparison to Supermemory Cloud

| Feature | Local | Cloud |
|---------|-------|-------|
| Data privacy | ✅ 100% local | ❌ Their servers |
| Dependencies | ✅ None | N/A |
| Cost | ✅ Free | 💰 Pro subscription |
| Semantic search | Basic (keyword) | AI-powered |
| Setup | `npm start` | Account required |
