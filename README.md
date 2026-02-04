# Claude-Supermemory

A Claude Code plugin that gives your AI persistent memory across sessions.
Your agent remembers what you worked on - across sessions, across projects.

## Choose Your Backend

| Option | Privacy | Setup | Cost |
|--------|---------|-------|------|
| **Local Backend** | 100% local, no data leaves your machine | Just Node.js | Free |
| **Supermemory Cloud** | Data stored on their servers | None | Pro subscription |

## Features

- **Context Injection**: On session start, relevant memories are automatically injected into Claude's context
- **Automatic Capture**: Conversation turns are captured and stored for future context
- **Codebase Indexing**: Index your project's architecture, patterns, and conventions

---

## Installation: Local Backend (Recommended)

All data stays on your machine. No external API calls. No Docker required.

### Prerequisites

- Node.js 18+

### Step 1: Start the Local Backend

```bash
cd local-backend
npm start
```

You should see:
```
Supermemory Local Backend
=========================
Data directory: ~/.supermemory-local
Database: ~/.supermemory-local/memories.json
Auth token file: ~/.supermemory-local/auth.token
Auth token: <your-token>

Loaded 0 memories

Server running at http://127.0.0.1:19877
```

**Important**: The auth token is displayed on first run. The client automatically loads it from `~/.supermemory-local/auth.token`.

### Step 2: Configure Environment

Add to your shell profile (`~/.zshrc` or `~/.bashrc`):

```bash
export SUPERMEMORY_API_URL=http://127.0.0.1:19877
export SUPERMEMORY_CC_API_KEY=local_ignored
```

Reload your shell:
```bash
source ~/.zshrc  # or source ~/.bashrc
```

### Step 3: Install the Plugin

In Claude Code, run:

```
/install-github erikcaineolson/claude-supermemory
```

Or manually:
```
/plugin marketplace add /path/to/claude-supermemory
/plugin install claude-supermemory
```

### Step 4: Restart Claude Code

Exit and start a new session. The plugin will connect to your local backend.

### Daily Usage

Before starting Claude Code, ensure the backend is running:

```bash
cd /path/to/claude-supermemory/local-backend
npm start
```

---

## Installation: Supermemory Cloud (Alternative)

If you prefer the hosted service:

```bash
# Set your API key
export SUPERMEMORY_CC_API_KEY="sm_..."
```

Get your API key at [console.supermemory.ai](https://console.supermemory.ai).

Then install the plugin:

```
/install-github erikcaineolson/claude-supermemory
```

## How It Works

### On Session Start

The plugin fetches relevant memories from Supermemory and injects them into Claude's context:

```
<supermemory-context>
The following is recalled context about the user...

## User Profile (Persistent)
- Prefers TypeScript over JavaScript
- Uses Bun as package manager

## Recent Context
- Working on authentication flow

</supermemory-context>
```

### During Session

Conversation turns are automatically captured on each stop and stored for future context.

### Skills

**super-search**: When you ask about past work, previous sessions, or want to recall information, the agent automatically searches your memories.

## Commands

### /claude-supermemory:index

Index your codebase into Supermemory. Explores project structure, architecture, conventions, and key files.

```
/claude-supermemory:index
```

### /claude-supermemory:logout

Log out from Supermemory and clear saved credentials.

```
/claude-supermemory:logout
```

## Configuration

### Environment Variables

```bash
# Required for cloud, ignored for local
SUPERMEMORY_CC_API_KEY=sm_...

# Required for local backend
SUPERMEMORY_API_URL=http://127.0.0.1:19877

# Optional
SUPERMEMORY_SKIP_TOOLS=Read,Glob,Grep    # Tools to not capture
SUPERMEMORY_DEBUG=true                    # Enable debug logging
SUPERMEMORY_AUDIT_LOG=true               # Enable security audit logging
```

### Settings File

Create `~/.supermemory-claude/settings.json`:

```json
{
  "skipTools": ["Read", "Glob", "Grep", "TodoWrite"],
  "captureTools": ["Edit", "Write", "Bash", "Task"],
  "maxProfileItems": 5,
  "debug": false
}
```

## Security

The local backend includes several security features:

- **Authentication**: Bearer token required for all API calls (except health check)
- **Token storage**: Auth token saved with 0600 permissions (owner read/write only)
- **CORS**: Only localhost origins allowed
- **Data isolation**: All data stored in `~/.supermemory-local/` with restricted permissions
- **Input validation**: Content size limits, sensitive data redaction
- **Timing-safe auth**: Token comparison resistant to timing attacks

## License

MIT
