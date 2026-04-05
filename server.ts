import express from 'express';
import { WebSocketServer } from 'ws';
import cors from 'cors';
import { createServer } from 'http';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3030;
const API_KEY = process.env.API_KEY || '';
const SESSION_TIMEOUT = 5 * 60 * 1000; // 5 minutes - 不活跃会话自动清理
const API_KEY_HEADER = 'x-api-key';

function authenticate(req, res, next) {
  if (!API_KEY) return next();
  const providedKey = req.headers[API_KEY_HEADER] || req.query.apiKey;
  if (providedKey !== API_KEY) {
    return res.status(401).json({ error: 'Unauthorized: invalid or missing API key' });
  }
  next();
}

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const DATA_FILE = path.join(__dirname, 'data.json');
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
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify({ sessions, tasks }, null, 2));
  } catch (e) {
    console.error('Failed to save data:', e);
  }
}

setInterval(saveData, 30000);

app.use('/api/sessions', authenticate);
app.use('/api/tasks', authenticate);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

app.post('/api/sessions/register', (req, res) => {
  console.log('[SESSION] Register request:', req.body);
  const { sessionId, projectPath, projectName, hostname, name, description, context, cwd } = req.body;
  const projectKey = hostname ? `${hostname}:${projectPath || cwd}` : sessionId;
  const existing = sessions.find(s => s.projectKey === projectKey || s.sessionId === sessionId);
  if (existing) {
    existing.lastActive = Date.now();
    existing.lastHeartbeat = new Date().toISOString();
    existing.status = 'active';
    if (projectName) existing.projectName = projectName;
    saveData();
    broadcast({ type: 'session:updated', session: existing });
    return res.json(existing);
  }
  const session = {
    id: uuidv4(),
    sessionId,
    projectPath: projectPath || cwd,
    projectKey,
    projectName: projectName || (projectPath ? projectPath.split(/[/\\]/).pop() : 'New Session'),
    hostname: hostname || '',
    status: 'active',
    createdAt: new Date().toISOString(),
    lastHeartbeat: new Date().toISOString(),
    lastActive: '已连接',
    context: context || {},
    description: description || ''
  };
  sessions.push(session);
  saveData();
  broadcast({ type: 'session:created', session });
  res.json(session);
});

app.post('/api/sessions/:sessionId/heartbeat', (req, res) => {
  let session = sessions.find(s => s.sessionId === req.params.sessionId);
  if (!session && req.body.projectKey) {
    session = sessions.find(s => s.projectKey === req.body.projectKey);
  }
  if (session) {
    session.sessionId = req.params.sessionId;
    if (req.body.projectName) session.projectName = req.body.projectName;
    session.lastHeartbeat = new Date().toISOString();
    session.status = 'active';
    saveData();
    broadcast({ type: 'session:updated', session });
  }
  res.json({ ok: true });
});

app.post('/api/sessions/:sessionId/log', (req, res) => {
  let session = sessions.find(s => s.sessionId === req.params.sessionId);
  if (!session && req.body.projectKey) {
    session = sessions.find(s => s.projectKey === req.body.projectKey);
  }
  if (session) {
    session.sessionId = req.params.sessionId;
    session.lastActivity = req.body.description || req.body.action || '进行中';
    session.lastHeartbeat = new Date().toISOString();
    if (!session.activities) session.activities = [];
    session.activities.unshift({
      description: req.body.description || req.body.action || '进行中',
      timestamp: new Date().toISOString()
    });
    if (session.activities.length > 50) session.activities = session.activities.slice(0, 50);
    saveData();
    broadcast({ type: 'activity', session });
  }
  res.json({ ok: true });
});

app.get('/api/sessions', (req, res) => {
  let filteredSessions = sessions;
  if (req.query.projectName) {
    const searchName = req.query.projectName.toLowerCase();
    filteredSessions = sessions.filter(s => 
      s.projectName.toLowerCase().includes(searchName)
    );
  }
  const totalInput = sessions.reduce((sum, s) => sum + (s.tokenUsage?.inputTokens || 0), 0);
  const totalOutput = sessions.reduce((sum, s) => sum + (s.tokenUsage?.outputTokens || 0), 0);
  const totalTokens = sessions.reduce((sum, s) => sum + (s.tokenUsage?.totalTokens || 0), 0);
  
  res.json({ 
    sessions: filteredSessions,
    tokenUsageSummary: {
      totalInputTokens: totalInput,
      totalOutputTokens: totalOutput,
      totalTokens: totalTokens,
      sessionCount: sessions.length,
      totalRatePerSecond: 0,
      totalRatePerMinute: 0
    }
  });
});

app.get('/api/tasks', (req, res) => {
  res.json({ tasks, sessions });
});

app.post('/api/tasks', authenticate, (req, res) => {
  const task = { id: uuidv4(), ...req.body, createdAt: Date.now(), updatedAt: Date.now() };
  tasks.push(task);
  res.status(201).json(task);
});

app.patch('/api/tasks/:id', authenticate, (req, res) => {
  const task = tasks.find(t => t.id === req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  Object.assign(task, req.body, { updatedAt: Date.now() });
  res.json(task);
});

app.delete('/api/tasks/:id', authenticate, (req, res) => {
  const idx = tasks.findIndex(t => t.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Task not found' });
  tasks.splice(idx, 1);
  res.status(204).send();
});

const server = createServer(app);
let wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  const totalInput = sessions.reduce((sum, s) => sum + (s.tokenUsage?.inputTokens || 0), 0);
  const totalOutput = sessions.reduce((sum, s) => sum + (s.tokenUsage?.outputTokens || 0), 0);
  const totalTokens = sessions.reduce((sum, s) => sum + (s.tokenUsage?.totalTokens || 0), 0);
  
  ws.send(JSON.stringify({ 
    type: 'connected', 
    sessions,
    tasks,
    summary: {
      totalSessions: sessions.length,
      activeSessions: sessions.filter(s => s.status === 'active').length,
      totalTasks: tasks.length,
      activeTasks: tasks.filter(t => t.status === 'in_progress').length,
      completedTasks: tasks.filter(t => t.status === 'completed').length,
      tokenUsageSummary: {
        totalInputTokens: totalInput,
        totalOutputTokens: totalOutput,
        totalTokens: totalTokens,
        sessionCount: sessions.length,
        totalRatePerSecond: 0,
        totalRatePerMinute: 0
      }
    }
  }));

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      if (data.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong' }));
      }
    } catch (e) {}
  });
});

function broadcast(data) {
  const msg = JSON.stringify(data);
  wss?.clients?.forEach(client => {
    if (client.readyState === 1) client.send(msg);
  });
}

server.listen(PORT, () => {
  const now = Date.now();
  const before = sessions.length;
  sessions = sessions.filter(s => {
    const last = new Date(s.lastHeartbeat).getTime();
    return now - last < SESSION_TIMEOUT;
  });
  if (sessions.length !== before) {
    saveData();
    console.log(`🧹 已清理 ${before - sessions.length} 个过期会话`);
  }
  setInterval(() => {
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
  }, 60000);
  console.log(`🎯 OpenCode Task Hub 运行中!`);
  console.log(`   仪表板: http://localhost:${PORT}`);
  console.log(`   ${sessions.length} 个会话已注册\n`);
});
