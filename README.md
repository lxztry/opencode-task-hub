# OpenCode Task Hub 📋

AI-powered task management hub for OpenCode projects. Smart task routing, progress tracking, and team collaboration.

## Features

### 🎯 Task Management
- **Smart Routing**: AI-powered task assignment based on skills and availability
- **Progress Tracking**: Real-time visualization of project progress
- **Priority Queue**: Intelligent priority management

### 🤖 AI Integration
- **Auto Assignment**: Suggest best team member for each task
- **Time Estimation**: AI-powered task duration estimates
- **Risk Detection**: Identify potential blockers early

### 📊 Analytics
- **Team Performance**: Track individual and team metrics
- **Sprint Velocity**: Measure and predict delivery speed
- **Burndown Charts**: Visual progress tracking

## Quick Start

```bash
# Install
npm install

# Run
npm run dev

# Build
npm run build
```

## Usage

### Create Task
```javascript
import { TaskManager } from './task-manager';

const manager = new TaskManager();
manager.createTask({
  title: 'Implement login',
  description: 'Add user authentication',
  priority: 'high',
  assignee: 'dev-001'
});
```

### Get Task Board
```javascript
const board = manager.getBoard();
// Returns: { todo: [], inProgress: [], done: [] }
```

### AI Task Assignment
```javascript
const suggestion = await manager.suggestAssignee(taskId);
// Returns: { assigneeId, confidence, reason }
```

## API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/tasks` | GET | List all tasks |
| `/api/tasks` | POST | Create task |
| `/api/tasks/:id` | PUT | Update task |
| `/api/tasks/:id` | DELETE | Delete task |
| `/api/board` | GET | Get Kanban board |
| `/api/analytics` | GET | Get analytics |

## Tech Stack

- **Frontend**: React, TypeScript, TailwindCSS
- **Backend**: Node.js, Express
- **Database**: SQLite (local), PostgreSQL (production)
- **AI**: OpenAI GPT-4

## License

MIT
