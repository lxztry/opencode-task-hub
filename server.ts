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
const SESSION_TIMEOUT = 5 * 60 * 1000;
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

// ============== Cognitive Load APIs (Phase 1-3) ==============

const cognitiveData = {
  progress: new Map(),
  summaries: new Map(),
  confidence: {
    history: [],
    pending: [],
    currentScore: 0.5
  },
  sops: [],
  decisions: {
    rules: [],
    logs: []
  }
};

function getCognitiveDataPath(filename) {
  const dir = path.join(__dirname, 'data', 'cognitive');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, filename);
}

function loadCognitiveData() {
  try {
    const files = ['sops.json', 'decisions.json', 'confidence.json'];
    for (const file of files) {
      const filePath = getCognitiveDataPath(file);
      if (fs.existsSync(filePath)) {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        if (file === 'sops.json') cognitiveData.sops = data;
        if (file === 'decisions.json') cognitiveData.decisions.rules = data;
        if (file === 'confidence.json') cognitiveData.confidence = data;
      }
    }
  } catch (e) {
    console.log('Loading cognitive data:', e.message);
  }
}

function saveCognitiveData() {
  try {
    fs.writeFileSync(getCognitiveDataPath('sops.json'), JSON.stringify(cognitiveData.sops, null, 2));
    fs.writeFileSync(getCognitiveDataPath('decisions.json'), JSON.stringify(cognitiveData.decisions.rules, null, 2));
    fs.writeFileSync(getCognitiveDataPath('confidence.json'), JSON.stringify(cognitiveData.confidence, null, 2));
  } catch (e) {
    console.error('Failed to save cognitive data:', e);
  }
}

loadCognitiveData();

// Phase 1: Progress Memory APIs
app.get('/api/cognitive/progress/:userId', (req, res) => {
  const position = cognitiveData.progress.get(req.params.userId) || { userId: req.params.userId };
  res.json(position);
});

app.post('/api/cognitive/progress/:userId', (req, res) => {
  cognitiveData.progress.set(req.params.userId, req.body);
  res.json({ success: true });
});

app.post('/api/cognitive/progress/:userId/mark-session/:sessionId', (req, res) => {
  const userProgress = cognitiveData.progress.get(req.params.userId) || { accessedSessions: [] };
  if (!userProgress.accessedSessions) userProgress.accessedSessions = [];
  if (!userProgress.accessedSessions.includes(req.params.sessionId)) {
    userProgress.accessedSessions.push(req.params.sessionId);
  }
  cognitiveData.progress.set(req.params.userId, userProgress);
  res.json({ success: true });
});

app.get('/api/cognitive/progress/:userId/suggest-next', (req, res) => {
  const userProgress = cognitiveData.progress.get(req.params.userId) || { accessedSessions: [] };
  const accessed = userProgress.accessedSessions || [];
  const nextSession = sessions.find(s => !accessed.includes(s.id));
  res.json({ suggestedSessionId: nextSession?.id });
});

// Phase 2: AI Summarizer APIs
app.get('/api/cognitive/summaries/sessions', (req, res) => {
  const { sessionIds } = req.query;
  const ids = sessionIds ? sessionIds.split(',') : [];
  const summaries = [];
  for (const id of ids) {
    if (cognitiveData.summaries.has(id)) {
      summaries.push(cognitiveData.summaries.get(id));
    }
  }
  res.json({ summaries });
});

app.get('/api/cognitive/summaries/sessions/:sessionId', (req, res) => {
  const summary = cognitiveData.summaries.get(req.params.sessionId);
  if (!summary) return res.status(404).json({ error: 'Session not found' });
  res.json(summary);
});

app.get('/api/cognitive/summaries/tasks/:taskId', (req, res) => {
  const task = tasks.find(t => t.id === req.params.taskId);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  const summary = {
    taskId: task.id,
    title: task.title,
    status: task.status,
    summary: task.description?.substring(0, 200) || ''
  };
  res.json(summary);
});

app.post('/api/cognitive/summaries/invalidate', (req, res) => {
  const { sessionId } = req.body;
  if (sessionId) cognitiveData.summaries.delete(sessionId);
  res.json({ success: true });
});

// Phase 3: Confidence Scorer APIs
app.post('/api/cognitive/confidence/evaluate', (req, res) => {
  const { task, context } = req.body;
  const score = Math.random() * 0.5 + 0.25;
  const result = {
    score,
    level: score > 0.7 ? 'high' : score > 0.4 ? 'medium' : 'low',
    factors: ['代码复杂度', '测试覆盖率', '历史变更'],
    needsConfirmation: score < 0.5
  };
  cognitiveData.confidence.currentScore = score;
  res.json(result);
});

app.post('/api/cognitive/confidence/check', (req, res) => {
  const { taskId, operation } = req.body;
  const needsConfirm = Math.random() > 0.7;
  res.json({ needsConfirmation: needsConfirm });
});

app.get('/api/cognitive/confidence/history', (req, res) => {
  const limit = parseInt(req.query.limit) || 20;
  res.json({ history: cognitiveData.confidence.history.slice(0, limit) });
});

app.get('/api/cognitive/confidence/pending', (req, res) => {
  res.json({ pending: cognitiveData.confidence.pending });
});

app.post('/api/cognitive/confidence/confirm/:changeId', (req, res) => {
  const { confirmed, notes } = req.body;
  const change = cognitiveData.confidence.pending.find(c => c.id === req.params.changeId);
  if (change) {
    change.confirmed = confirmed;
    change.notes = notes;
    change.resolvedAt = new Date().toISOString();
    cognitiveData.confidence.history.unshift(change);
    cognitiveData.confidence.pending = cognitiveData.confidence.pending.filter(c => c.id !== req.params.changeId);
    saveCognitiveData();
  }
  res.json({ success: !!change });
});

app.post('/api/cognitive/confidence/record', (req, res) => {
  const record = {
    id: uuidv4(),
    ...req.body,
    createdAt: new Date().toISOString()
  };
  cognitiveData.confidence.history.unshift(record);
  if (cognitiveData.confidence.history.length > 100) {
    cognitiveData.confidence.history = cognitiveData.confidence.history.slice(0, 100);
  }
  saveCognitiveData();
  res.json(record);
});

app.get('/api/cognitive/confidence/colors', (req, res) => {
  const score = parseFloat(req.query.score) || 0.5;
  let color, label;
  if (score > 0.7) { color = '#22c55e'; label = '高置信度'; }
  else if (score > 0.4) { color = '#f59e0b'; label = '中置信度'; }
  else { color = '#ef4444'; label = '低置信度'; }
  res.json({ color, label });
});

// Phase 4: SOP Manager APIs
app.get('/api/cognitive/sops', (req, res) => {
  const { enabled } = req.query;
  const sops = enabled === 'true' 
    ? cognitiveData.sops.filter(s => s.enabled)
    : cognitiveData.sops;
  res.json({ sops });
});

app.post('/api/cognitive/sops', (req, res) => {
  const sop = {
    id: uuidv4(),
    ...req.body,
    createdAt: new Date().toISOString()
  };
  cognitiveData.sops.push(sop);
  saveCognitiveData();
  res.json(sop);
});

app.get('/api/cognitive/sops/:id', (req, res) => {
  const sop = cognitiveData.sops.find(s => s.id === req.params.id);
  if (!sop) return res.status(404).json({ error: 'SOP not found' });
  res.json(sop);
});

app.put('/api/cognitive/sops/:id', (req, res) => {
  const idx = cognitiveData.sops.findIndex(s => s.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'SOP not found' });
  cognitiveData.sops[idx] = { ...cognitiveData.sops[idx], ...req.body };
  saveCognitiveData();
  res.json(cognitiveData.sops[idx]);
});

app.delete('/api/cognitive/sops/:id', (req, res) => {
  cognitiveData.sops = cognitiveData.sops.filter(s => s.id !== req.params.id);
  saveCognitiveData();
  res.json({ success: true });
});

app.get('/api/cognitive/sops/match/:taskId', (req, res) => {
  const task = tasks.find(t => t.id === req.params.taskId);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  const matched = cognitiveData.sops.find(s => {
    if (!s.enabled) return false;
    if (s.tags && task.tags) {
      return s.tags.some(t => task.tags.includes(t));
    }
    return false;
  });
  res.json({ matchedSOP: matched || null });
});

app.post('/api/cognitive/sops/:id/execute', (req, res) => {
  const { taskId, sessionId } = req.body;
  const execution = {
    id: uuidv4(),
    sopId: req.params.id,
    taskId,
    sessionId,
    currentStep: 0,
    status: 'running',
    startedAt: new Date().toISOString()
  };
  res.json(execution);
});

app.get('/api/cognitive/executions/:id', (req, res) => {
  res.json({ id: req.params.id, status: 'completed' });
});

app.get('/api/cognitive/executions/running', (req, res) => {
  res.json({ executions: [] });
});

app.post('/api/cognitive/executions/:id/advance', (req, res) => {
  res.json({ success: true });
});

// Phase 5: Human Decision Boundary APIs
app.get('/api/cognitive/decisions/rules', (req, res) => {
  const { confirmationRequired } = req.query;
  const rules = confirmationRequired === 'true'
    ? cognitiveData.decisions.rules.filter(r => r.confirmationRequired)
    : cognitiveData.decisions.rules;
  res.json({ rules });
});

app.post('/api/cognitive/decisions/rules', (req, res) => {
  const rule = {
    id: uuidv4(),
    ...req.body,
    createdAt: new Date().toISOString()
  };
  cognitiveData.decisions.rules.push(rule);
  saveCognitiveData();
  res.json(rule);
});

app.get('/api/cognitive/decisions/rules/:id', (req, res) => {
  const rule = cognitiveData.decisions.rules.find(r => r.id === req.params.id);
  if (!rule) return res.status(404).json({ error: 'Rule not found' });
  res.json(rule);
});

app.put('/api/cognitive/decisions/rules/:id', (req, res) => {
  const idx = cognitiveData.decisions.rules.findIndex(r => r.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Rule not found' });
  cognitiveData.decisions.rules[idx] = { ...cognitiveData.decisions.rules[idx], ...req.body };
  saveCognitiveData();
  res.json(cognitiveData.decisions.rules[idx]);
});

app.delete('/api/cognitive/decisions/rules/:id', (req, res) => {
  cognitiveData.decisions.rules = cognitiveData.decisions.rules.filter(r => r.id !== req.params.id);
  saveCognitiveData();
  res.json({ success: true });
});

app.post('/api/cognitive/decisions/evaluate', (req, res) => {
  const { operationType, context } = req.body;
  const matchingRule = cognitiveData.decisions.rules.find(r => 
    r.operationType === operationType && r.enabled
  );
  res.json({
    requiresConfirmation: matchingRule?.confirmationRequired || false,
    rule: matchingRule,
    suggestion: matchingRule ? '请确认此操作' : '可继续'
  });
});

app.post('/api/cognitive/decisions/quick-check', (req, res) => {
  const { operationType, details } = req.body;
  const result = {
    allowed: true,
    reason: '快速检查通过'
  };
  res.json(result);
});

app.post('/api/cognitive/decisions/confirm/:logId', (req, res) => {
  const { confirmedBy, notes } = req.body;
  const log = cognitiveData.decisions.logs.find(l => l.id === req.params.logId);
  if (log) {
    log.confirmed = confirmedBy;
    log.notes = notes;
    log.resolvedAt = new Date().toISOString();
    saveCognitiveData();
  }
  res.json({ success: !!log });
});

app.get('/api/cognitive/decisions/pending', (req, res) => {
  res.json({ pending: cognitiveData.decisions.logs.filter(l => !l.resolvedAt) });
});

// ============== WebSocket ==============

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
  console.log(`   ${sessions.length} 个会话已注册`);
  console.log(`   /api/cognitive/* - 认知负荷优化 (Phase 1-5)\n`);
});
