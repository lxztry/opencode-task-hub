import express from 'express';
import { WebSocketServer } from 'ws';
import cors from 'cors';
import { createServer } from 'http';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import os from 'os';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.join(__dirname, 'data.json');
const PORT = 3030;
const SESSION_TIMEOUT = 5 * 60 * 1000; // 5 minutes

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

let sessions = [];
let tasks = [];

if (fs.existsSync(DATA_FILE)) {
  try {
    const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
    sessions = data.sessions || [];
    tasks = data.tasks || [];
  } catch (e) {
    sessions = [];
    tasks = [];
  }
}

function saveData() {
  fs.writeFileSync(DATA_FILE, JSON.stringify({ sessions, tasks }, null, 2));
}

function cleanExpiredSessions() {
  const now = Date.now();
  const before = sessions.length;
  sessions = sessions.filter(s => {
    const last = new Date(s.lastHeartbeat).getTime();
    return now - last < SESSION_TIMEOUT;
  });
  if (sessions.length !== before) {
    saveData();
    broadcast({ type: 'sessions:cleanup', removed: before - sessions.length });
    console.log(`🧹 已清理 ${before - sessions.length} 个过期会话`);
  }
}

function broadcast(data) {
  const msg = JSON.stringify(data);
  wss?.clients?.forEach(client => {
    if (client.readyState === 1) client.send(msg);
  });
}

let wss;

app.get('/api/sessions', (req, res) => {
  res.json({ sessions });
});

app.post('/api/sessions/register', (req, res) => {
  const { sessionId, projectPath, projectName, hostname } = req.body;
  const existing = sessions.find(s => s.sessionId === sessionId);
  if (existing) {
    existing.lastHeartbeat = new Date().toISOString();
    existing.status = 'active';
    saveData();
    broadcast({ type: 'session:updated', session: existing });
    return res.json(existing);
  }
  const session = {
    id: uuidv4(),
    sessionId,
    projectPath,
    projectName: projectName || path.basename(projectPath) || 'unknown',
    hostname: hostname || os.hostname(),
    status: 'active',
    createdAt: new Date().toISOString(),
    lastHeartbeat: new Date().toISOString(),
    lastActivity: '已连接'
  };
  sessions.push(session);
  saveData();
  broadcast({ type: 'session:created', session });
  res.json(session);
});

app.post('/api/sessions/:sessionId/heartbeat', (req, res) => {
  const session = sessions.find(s => s.sessionId === req.params.sessionId);
  if (session) {
    session.lastHeartbeat = new Date().toISOString();
    session.status = 'active';
    saveData();
    broadcast({ type: 'session:updated', session });
  }
  res.json({ ok: true });
});

app.post('/api/sessions/:sessionId/log', (req, res) => {
  const session = sessions.find(s => s.sessionId === req.params.sessionId);
  if (session) {
    session.lastActivity = req.body.description || req.body.action || '进行中';
    session.lastHeartbeat = new Date().toISOString();
    saveData();
    broadcast({ type: 'activity', session });
  }
  res.json({ ok: true });
});

app.delete('/api/sessions/:sessionId', (req, res) => {
  const idx = sessions.findIndex(s => s.sessionId === req.params.sessionId);
  if (idx !== -1) {
    sessions.splice(idx, 1);
    saveData();
    broadcast({ type: 'session:removed', sessionId: req.params.sessionId });
  }
  res.json({ ok: true });
});

app.get('/api/tasks', (req, res) => {
  res.json({ tasks, sessions });
});

app.post('/api/tasks', (req, res) => {
  const task = {
    id: uuidv4(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: 'pending',
    progress: 0,
    sessionId: null,
    ...req.body
  };
  tasks.unshift(task);
  saveData();
  broadcast({ type: 'task:created', task });
  res.json(task);
});

app.put('/api/tasks/:id', (req, res) => {
  const idx = tasks.findIndex(t => t.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Task not found' });
  tasks[idx] = { ...tasks[idx], ...req.body, updatedAt: new Date().toISOString() };
  saveData();
  broadcast({ type: 'task:updated', task: tasks[idx] });
  res.json(tasks[idx]);
});

app.delete('/api/tasks/:id', (req, res) => {
  const idx = tasks.findIndex(t => t.id === req.params.id);
  if (idx !== -1) {
    tasks.splice(idx, 1);
    saveData();
    broadcast({ type: 'task:deleted', taskId: req.params.id });
  }
  res.json({ ok: true });
});

app.post('/api/tasks/:id/assign', (req, res) => {
  const task = tasks.find(t => t.id === req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  task.sessionId = req.body.sessionId;
  task.status = 'in_progress';
  task.updatedAt = new Date().toISOString();
  saveData();
  broadcast({ type: 'task:updated', task });
  res.json(task);
});

const server = createServer(app);
wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  ws.send(JSON.stringify({ 
    type: 'connected', 
    sessions,
    tasks,
    summary: {
      totalSessions: sessions.length,
      activeSessions: sessions.filter(s => s.status === 'active').length,
      totalTasks: tasks.length,
      activeTasks: tasks.filter(t => t.status === 'in_progress').length,
      completedTasks: tasks.filter(t => t.status === 'completed').length
    }
  }));
});

server.listen(PORT, () => {
  cleanExpiredSessions();
  setInterval(cleanExpiredSessions, 60 * 1000); // 每分钟检查一次
  console.log(`\n🎯 OpenCode Task Hub 运行中!`);
  console.log(`   仪表板: http://localhost:${PORT}`);
  console.log(`   ${sessions.length} 个会话已注册\n`);
});
