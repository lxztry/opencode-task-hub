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
const PORT = process.env.PORT || 3030;
const API_KEY = process.env.API_KEY || '';
const SESSION_TIMEOUT = 5 * 60 * 1000; // 5 minutes
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

function calculateRate(history, seconds = 60) {
  if (!history || history.length < 2) return 0;
  const now = Date.now();
  const cutoff = now - seconds * 1000;
  const recent = history.filter(h => h.timestamp > cutoff);
  if (recent.length < 2) return 0;
  const first = recent[0];
  const last = recent[recent.length - 1];
  const timeDiff = (last.timestamp - first.timestamp) / 1000;
  if (timeDiff <= 0) return 0;
  return Math.round((last.tokens - first.tokens) / timeDiff);
}

app.use('/api/sessions', authenticate);
app.use('/api/tasks', authenticate);

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
  
  const sessionsWithRate = filteredSessions.map(s => {
    const history = s.tokenUsage?.history || [];
    const ratePerSecond = calculateRate(history, 60);
    const ratePerMinute = ratePerSecond * 60;
    return {
      ...s,
      tokenRate: {
        perSecond: ratePerSecond,
        perMinute: ratePerMinute
      }
    };
  });
  
  const totalRatePerSecond = sessionsWithRate.reduce((sum, s) => sum + (s.tokenRate?.perSecond || 0), 0);
  
  res.json({ 
    sessions: sessionsWithRate,
    tokenUsageSummary: {
      totalInputTokens: totalInput,
      totalOutputTokens: totalOutput,
      totalTokens: totalTokens,
      sessionCount: sessions.length,
      totalRatePerSecond: totalRatePerSecond,
      totalRatePerMinute: totalRatePerSecond * 60
    }
  });
});

app.post('/api/sessions/register', (req, res) => {
  const { sessionId, projectPath, projectName, hostname } = req.body;
  const projectKey = `${hostname}:${projectPath}`;
  const existing = sessions.find(s => s.projectKey === projectKey);
  if (existing) {
    existing.sessionId = sessionId;
    existing.projectName = projectName || existing.projectName || path.basename(projectPath) || 'unknown';
    existing.lastHeartbeat = new Date().toISOString();
    existing.status = 'active';
    existing.lastActivity = '已连接';
    saveData();
    broadcast({ type: 'session:updated', session: existing });
    return res.json(existing);
  }
  const session = {
    id: uuidv4(),
    sessionId,
    projectPath,
    projectKey,
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

app.post('/api/sessions/:sessionId/token-usage', (req, res) => {
  const targetSessionId = req.params.sessionId;
  const projectKey = req.body.projectKey;
  
  let session = sessions.find(s => s.sessionId === targetSessionId);
  if (!session && projectKey) {
    session = sessions.find(s => s.projectKey === projectKey);
  }
  if (!session && req.body.id) {
    session = sessions.find(s => s.id === req.body.id);
  }
  
  if (session) {
    const { inputTokens, outputTokens, model, conversationCount, totalTokens: bodyTotalTokens } = req.body;
    if (!session.tokenUsage) {
      session.tokenUsage = {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        conversationCount: 0,
        lastUpdated: null,
        history: []
      };
    }
    const now = Date.now();
    
    if (typeof bodyTotalTokens === 'number' && bodyTotalTokens > 0) {
      const prevTotal = session.tokenUsage.totalTokens;
      const increment = bodyTotalTokens - prevTotal;
      if (increment > 0) {
        if (!session.tokenUsage.history) session.tokenUsage.history = [];
        session.tokenUsage.history.push({ timestamp: now, tokens: increment });
        if (session.tokenUsage.history.length > 100) {
          session.tokenUsage.history = session.tokenUsage.history.slice(-100);
        }
        session.tokenUsage.totalTokens = bodyTotalTokens;
      }
    } else {
      const incrementTokens = (inputTokens || 0) + (outputTokens || 0);
      if (incrementTokens > 0) {
        if (!session.tokenUsage.history) session.tokenUsage.history = [];
        session.tokenUsage.history.push({ timestamp: now, tokens: incrementTokens });
        if (session.tokenUsage.history.length > 100) {
          session.tokenUsage.history = session.tokenUsage.history.slice(-100);
        }
        if (typeof inputTokens === 'number') session.tokenUsage.inputTokens += inputTokens;
        if (typeof outputTokens === 'number') session.tokenUsage.outputTokens += outputTokens;
        session.tokenUsage.totalTokens += incrementTokens;
      }
    }
    
    if (typeof conversationCount === 'number') {
      session.tokenUsage.conversationCount = Math.max(session.tokenUsage.conversationCount, conversationCount);
    }
    session.tokenUsage.lastUpdated = new Date().toISOString();
    session.lastHeartbeat = new Date().toISOString();
    saveData();
    broadcast({ type: 'session:updated', session });
  } else {
    console.warn(`Token usage update failed: session not found. sessionId=${targetSessionId}, projectKey=${projectKey}`);
  }
  res.json({ ok: !!session });
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

app.get('/api/sessions/:id/activities', (req, res) => {
  const session = sessions.find(s => s.id === req.params.id || s.sessionId === req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  res.json({ activities: session.activities || [] });
});

app.get('/api/tasks', (req, res) => {
  let filteredTasks = tasks;
  if (req.query.sessionId) {
    filteredTasks = tasks.filter(t => 
      t.sessionId === req.query.sessionId || 
      t.projectKey === req.query.sessionId ||
      t.sessionId === parseInt(req.query.sessionId)
    );
  }
  res.json({ tasks: filteredTasks, sessions });
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
  const totalInput = sessions.reduce((sum, s) => sum + (s.tokenUsage?.inputTokens || 0), 0);
  const totalOutput = sessions.reduce((sum, s) => sum + (s.tokenUsage?.outputTokens || 0), 0);
  const totalTokens = sessions.reduce((sum, s) => sum + (s.tokenUsage?.totalTokens || 0), 0);
  
  const sessionsWithRate = sessions.map(s => {
    const history = s.tokenUsage?.history || [];
    const ratePerSecond = calculateRate(history, 60);
    return {
      ...s,
      tokenRate: {
        perSecond: ratePerSecond,
        perMinute: ratePerSecond * 60
      }
    };
  });
  
  const totalRatePerSecond = sessionsWithRate.reduce((sum, s) => sum + (s.tokenRate?.perSecond || 0), 0);
  
  ws.send(JSON.stringify({ 
    type: 'connected', 
    sessions: sessionsWithRate,
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
        totalRatePerSecond: totalRatePerSecond,
        totalRatePerMinute: totalRatePerSecond * 60
      }
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
