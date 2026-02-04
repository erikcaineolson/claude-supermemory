# Supermemory Local Backend

A self-hosted, privacy-focused replacement for the Supermemory API.

**All data stays on your machine. Nothing is sent to external servers.**

## Architecture

- **ChromaDB** (Docker) - Vector database for semantic search
- **Node.js server** - API compatibility layer

## Quick Start

```bash
# 1. Start ChromaDB
npm run docker:up

# 2. Start the API server
npm start

# 3. Configure the plugin
export SUPERMEMORY_API_URL=http://127.0.0.1:19877
export SUPERMEMORY_CC_API_KEY=local_ignored
```

## Docker Commands

```bash
# Start ChromaDB
npm run docker:up

# Stop ChromaDB
npm run docker:down

# View logs
npm run docker:logs
```

## Data Storage

- **ChromaDB data**: Docker volume `supermemory-local_chroma_data`
- **Location**: Managed by Docker, persists across restarts

To backup your data:
```bash
docker run --rm -v supermemory-local_chroma_data:/data -v $(pwd):/backup alpine tar czf /backup/chroma-backup.tar.gz /data
```

To restore:
```bash
docker run --rm -v supermemory-local_chroma_data:/data -v $(pwd):/backup alpine tar xzf /backup/chroma-backup.tar.gz -C /
```

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/add` | POST | Add a memory |
| `/profile` | POST | Get user profile with facts |
| `/search/memories` | POST | Search memories |
| `/memories/list` | POST | List memories |
| `/memories/:id` | DELETE | Delete a memory |
| `/health` | GET | Health check |

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `SUPERMEMORY_LOCAL_PORT` | `19877` | API server port |
| `CHROMA_URL` | `http://127.0.0.1:8000` | ChromaDB URL |

## Security

- Server binds to `127.0.0.1` only (localhost)
- ChromaDB telemetry is disabled
- No authentication required (local only)
- Data persisted in Docker volumes with standard permissions

## Comparison to Supermemory Cloud

| Feature | Local | Cloud |
|---------|-------|-------|
| Data privacy | ✅ 100% local | ❌ Stored on their servers |
| Semantic search | ✅ ChromaDB | ✅ Proprietary |
| Cost | ✅ Free | 💰 Pro subscription |
| Setup | Docker required | None |
| Profile generation | Basic extraction | AI-powered |

## Troubleshooting

### ChromaDB won't start
```bash
# Check if port 8000 is in use
lsof -i :8000

# Check Docker logs
docker logs supermemory-chromadb
```

### Connection refused
Make sure ChromaDB is running:
```bash
curl http://127.0.0.1:8000/api/v1/heartbeat
```

### Reset all data
```bash
npm run docker:down
docker volume rm supermemory-local_chroma_data
npm run docker:up
```
