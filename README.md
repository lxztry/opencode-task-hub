# OpenCode Task Hub

[![npm version](https://img.shields.io/npm/v/opencode-task-hub.svg)](https://www.npmjs.com/package/opencode-task-hub)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js version](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen)](https://nodejs.org/)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Linux%20%7C%20Windows-blue)](https://github.com/lztry/opencode-task-hub)

> Real-time task hub for managing multiple OpenCode sessions with WebSocket dashboard

OpenCode Task Hub enables you to monitor and manage all your OpenCode AI coding assistant sessions from a single dashboard. Track active sessions, manage tasks, and get real-time activity updates across all your projects.

## Features

- **Real-time Monitoring** - WebSocket-powered live updates for all OpenCode sessions
- **Multi-Session Management** - View and track multiple OpenCode sessions across different projects
- **Task Management** - Create, assign, update, and complete tasks from the dashboard
- **Activity Tracking** - Monitor what each session is currently doing
- **Cross-Platform** - Works on macOS, Linux, and Windows
- **Local-First** - All data stays on your machine, no cloud required
- **Plugin Integration** - Automatic session registration via OpenCode plugin

## Screenshot

![OpenCode Task Hub Dashboard](docs/screenshot.png)

## Quick Start

### Prerequisites

- Node.js >= 18.0.0
- OpenCode AI coding assistant

### Installation

#### Option 1: npm (Recommended)

```bash
npm install -g opencode-task-hub
opencode-task-hub
```

#### Option 2: Clone & Run

```bash
git clone https://github.com/lztry/opencode-task-hub.git
cd opencode-task-hub
npm install

# Install plugin (macOS/Linux)
./install.sh

# Install plugin (Windows)
install.bat

# Start server
npm start
```

### Usage

1. **Start the server:**
   ```bash
   npm start
   # or for development with auto-reload:
   npm run dev
   ```

2. **Open the dashboard:**
   ```
   http://localhost:3030
   ```

3. **Start using OpenCode:**
   - Each OpenCode session will automatically register with the hub
   - Activities (tool executions) are tracked in real-time
   - Tasks can be created and assigned from the dashboard

## Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  OpenCode #1    │────▶│                  │◀────│  OpenCode #2    │
│  (Project A)    │     │   Task Hub       │     │  (Project B)    │
└─────────────────┘     │   Server         │     └─────────────────┘
                        │   + WebSocket    │
┌─────────────────┐     │                  │     ┌─────────────────┐
│  Dashboard      │◀────│   (Port 3030)    │────▶│  OpenCode #N    │
│  (Browser)      │     │                  │     │  (Project N)    │
└─────────────────┘     └──────────────────┘     └─────────────────┘
```

## API Reference

### REST Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/sessions` | List all registered sessions |
| POST | `/api/sessions/register` | Register a new session |
| POST | `/api/sessions/:id/heartbeat` | Send heartbeat |
| POST | `/api/sessions/:id/log` | Log activity |
| DELETE | `/api/sessions/:id` | Remove a session |
| GET | `/api/tasks` | List all tasks |
| POST | `/api/tasks` | Create a new task |
| PUT | `/api/tasks/:id` | Update a task |
| DELETE | `/api/tasks/:id` | Delete a task |
| POST | `/api/tasks/:id/assign` | Assign task to session |

### WebSocket Events

| Event | Direction | Description |
|-------|-----------|-------------|
| `connected` | Server → Client | Initial state on connect |
| `session:created` | Server → Client | New session registered |
| `session:updated` | Server → Client | Session heartbeat/update |
| `session:removed` | Server → Client | Session disconnected |
| `activity` | Server → Client | Session activity log |
| `task:created` | Server → Client | New task created |
| `task:updated` | Server → Client | Task status changed |
| `task:deleted` | Server → Client | Task deleted |

## Configuration

### Server Port

Default port is `3030`. To change:

```javascript
// server.js
const PORT = 3000; // Change this
```

### Data Storage

Data is persisted to `data.json` in the project directory. To use a different location:

```bash
DATA_FILE=/path/to/data.json npm start
```

## Plugin Tools

The task-reporter plugin provides these tools for OpenCode:

- `registerTask` - Manually register current session
- `updateTaskActivity` - Log custom activity descriptions

## Troubleshooting

### Sessions not showing up?

1. Make sure the plugin is installed:
   ```bash
   # macOS/Linux
   ls ~/.config/opencode/plugins/task-reporter.js
   
   # Windows
   dir %USERPROFILE%\.config\opencode\plugins\task-reporter.js
   ```

2. Check opencode.json has the plugin configured:
   ```json
   {
     "plugin": ["task-reporter"]
   }
   ```

3. Restart OpenCode after installing the plugin

### Dashboard shows disconnected?

- Check if the server is running: `curl http://localhost:3030/api/sessions`
- Refresh the browser page

## Contributing

Contributions are welcome! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for version history.

## License

MIT License - see [LICENSE](LICENSE) for details.

## Related

- [OpenCode](https://opencode.ai) - AI coding assistant
- [Agentlytics](https://github.com/f/agentlytics) - Analytics for AI coding agents
- [OpenCastle](https://github.com/etylsarin/opencastle) - Multi-agent collaboration framework
