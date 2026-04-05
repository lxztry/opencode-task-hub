import express from 'express';
import { WebSocketServer } from 'ws';
import cors from 'cors';
import { createServer } from 'http';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import os from 'os';

// Import our new modules
import { Database } from './src/database.js';
import { EnhancedTaskManager } from './src/enhanced-task-manager.js';
import { SessionManager } from './src/session-manager.js';
import { AIEnhancer } from './src/ai-enhancer.js';
import { WebhookManager, webhookManager } from './src/webhook-manager.js';
import { Analytics } from './src/analytics.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
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

// Initialize modules
const db = new Database(path.join(__dirname, 'data', 'taskhub.db'));
const taskManager = new EnhancedTaskManager(db);
const sessionManager = taskManager.getSessionManager();
const aiEnhancer = new AIEnhancer();
const webhookManager = webhookManager;
const analytics = taskManager.getAnalytics();

// ============== Legacy Data (from JSON file) ==============

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

// ============== API Routes ==============

app.use('/api/sessions', authenticate);
app.use('/api/tasks', authenticate);
app.use('/api/enhanced', authenticate);
app.use('/api/ai', authenticate);
app.use('/api/webhooks', authenticate);
app.use('/api/analytics', authenticate);

// ============== Original Session APIs ==============

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

// ============== Enhanced Session APIs (New) ==============

app.get('/api/enhanced/sessions', (req, res) => {
  const { status, type, search } = req.query;
  
  let result = sessionManager.getAllSessions();
  
  if (status) {
    result = sessionManager.getSessionsByStatus(status);
  }
  if (type) {
    result = sessionManager.getSessionsByType(type);
  }
  if (search) {
    result = sessionManager.searchSessions(search);
  }
  
  res.json({ sessions: result });
});

app.post('/api/enhanced/sessions', async (req, res) => {
  try {
    const session = await sessionManager.createSession({
      name: req.body.name,
      description: req.body.description,
      type: req.body.type,
      parentId: req.body.parentId,
      agentType: req.body.agentType,
      tags: req.body.tags,
      creator: req.body.creator || 'system',
      priority: req.body.priority
    });
    
    await webhookManager.onSessionCreated(session);
    res.json(session);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/enhanced/sessions/:id', (req, res) => {
  const session = sessionManager.getSession(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  res.json(session);
});

app.put('/api/enhanced/sessions/:id', async (req, res) => {
  try {
    const session = await sessionManager.updateSession(req.params.id, req.body);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    res.json(session);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/enhanced/sessions/:id', async (req, res) => {
  try {
    const result = await sessionManager.deleteSession(req.params.id);
    res.json({ success: result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/enhanced/sessions/:id/tree', (req, res) => {
  const tree = sessionManager.getSessionTree(req.params.id);
  if (!tree) return res.status(404).json({ error: 'Session not found' });
  res.json(tree);
});

app.post('/api/enhanced/sessions/:id/checkpoint', async (req, res) => {
  try {
    const checkpoint = await sessionManager.createCheckpoint(
      req.params.id,
      req.body.name || `Checkpoint ${Date.now()}`
    );
    if (!checkpoint) return res.status(404).json({ error: 'Session not found' });
    res.json(checkpoint);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/enhanced/sessions/:id/restore/:checkpointId', async (req, res) => {
  try {
    const result = await sessionManager.restoreCheckpoint(req.params.id, req.params.checkpointId);
    res.json({ success: result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============== Enhanced Task APIs (New) ==============

app.get('/api/enhanced/tasks', (req, res) => {
  res.json({ tasks: taskManager.getAllTasks() });
});

app.post('/api/enhanced/tasks', async (req, res) => {
  try {
    const task = await taskManager.createTask({
      title: req.body.title,
      description: req.body.description,
      priority: req.body.priority,
      assignee: req.body.assignee,
      tags: req.body.tags,
      sessionId: req.body.sessionId,
      estimatedHours: req.body.estimatedHours,
      dueDate: req.body.dueDate
    });
    res.json(task);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/enhanced/tasks/from-text', async (req, res) => {
  try {
    const task = await taskManager.createTaskFromText(req.body.text, req.body.creator || 'system');
    res.json(task);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/enhanced/tasks/:id', (req, res) => {
  const task = taskManager.getTask(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  res.json(task);
});

app.put('/api/enhanced/tasks/:id', async (req, res) => {
  try {
    const task = await taskManager.updateTask(req.params.id, req.body);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    res.json(task);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/enhanced/tasks/:id', async (req, res) => {
  try {
    const result = await taskManager.deleteTask(req.params.id);
    res.json({ success: result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Subtasks
app.post('/api/enhanced/tasks/:id/subtasks', async (req, res) => {
  try {
    const task = await taskManager.addSubtask(req.params.id, req.body.title);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    res.json(task);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/enhanced/tasks/:id/subtasks/:subtaskId/toggle', async (req, res) => {
  try {
    const task = await taskManager.toggleSubtask(req.params.id, req.params.subtaskId);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    res.json(task);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Comments
app.post('/api/enhanced/tasks/:id/comments', async (req, res) => {
  try {
    const task = await taskManager.addComment(
      req.params.id,
      req.body.author,
      req.body.content,
      req.body.mentions
    );
    if (!task) return res.status(404).json({ error: 'Task not found' });
    res.json(task);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============== Board APIs (New) ==============

app.get('/api/enhanced/boards', (req, res) => {
  res.json({ boards: taskManager.getAllBoards() });
});

app.get('/api/enhanced/boards/:id', (req, res) => {
  const board = taskManager.getBoard(req.params.id);
  if (!board) return res.status(404).json({ error: 'Board not found' });
  res.json(board);
});

app.post('/api/enhanced/boards', (req, res) => {
  const board = taskManager.createBoard({
    name: req.body.name,
    type: req.body.type,
    columns: req.body.columns
  });
  res.json(board);
});

app.put('/api/enhanced/boards/:id/filter', (req, res) => {
  taskManager.setBoardFilter(req.params.id, req.body.filters);
  const board = taskManager.getBoard(req.params.id);
  res.json(board);
});

// ============== AI APIs (New) ==============

app.post('/api/ai/analyze/:taskId', async (req, res) => {
  try {
    const analysis = await taskManager.analyzeTask(req.params.taskId);
    if (!analysis) return res.status(404).json({ error: 'Task not found' });
    res.json(analysis);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/ai/suggest/:taskId', async (req, res) => {
  try {
    const suggestion = await taskManager.suggestAssignee(req.params.taskId);
    if (!suggestion) return res.status(404).json({ error: 'Task not found' });
    res.json(suggestion);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/ai/parse', async (req, res) => {
  try {
    const parsed = await taskManager.parseNaturalLanguage(req.body.text);
    res.json(parsed);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/ai/summarize/:sessionId', async (req, res) => {
  try {
    const summary = await taskManager.generateSessionSummary(req.params.sessionId);
    if (!summary) return res.status(404).json({ error: 'Session not found' });
    res.json({ summary });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/ai/risks', async (req, res) => {
  try {
    const risks = await taskManager.detectRisks();
    res.json({ risks });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/ai/forecast', async (req, res) => {
  try {
    const forecast = await taskManager.forecastSprint(
      req.body.teamSize || 3,
      req.body.days || 14
    );
    res.json(forecast);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============== Webhook APIs (New) ==============

app.get('/api/webhooks', (req, res) => {
  res.json({ webhooks: webhookManager.getAllWebhooks() });
});

app.post('/api/webhooks', (req, res) => {
  const webhook = webhookManager.createWebhook({
    url: req.body.url,
    events: req.body.events,
    secret: req.body.secret
  });
  res.json(webhook);
});

app.delete('/api/webhooks/:id', (req, res) => {
  const result = webhookManager.deleteWebhook(req.params.id);
  res.json({ success: result });
});

app.put('/api/webhooks/:id/toggle', (req, res) => {
  const result = webhookManager.toggleWebhook(req.params.id, req.body.active);
  res.json({ success: result });
});

// GitHub Integration
app.post('/api/webhooks/github/link', async (req, res) => {
  try {
    const result = await webhookManager.linkGitHubPR(req.body.taskId, req.body.prUrl);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============== Analytics APIs (New) ==============

app.get('/api/analytics/summary', (req, res) => {
  const performance = analytics.getTeamPerformance(30);
  res.json({
    teamPerformance: performance,
    taskStats: {
      total: taskManager.getAllTasks().length,
      completed: taskManager.getAllTasks().filter(t => t.status === 'done').length,
      inProgress: taskManager.getAllTasks().filter(t => t.status === 'in-progress').length,
      backlog: taskManager.getAllTasks().filter(t => t.status === 'backlog').length
    }
  });
});

app.get('/api/analytics/velocity', (req, res) => {
  const days = parseInt(req.query.days) || 14;
  const velocity = analytics.calculateVelocity('current', days);
  res.json(velocity);
});

app.get('/api/analytics/team-performance', (req, res) => {
  const days = parseInt(req.query.days) || 30;
  const performance = analytics.getTeamPerformance(days);
  res.json({ performance });
});

app.get('/api/analytics/burndown', (req, res) => {
  const days = parseInt(req.query.days) || 14;
  const startDate = Date.now() - days * 86400000;
  const endDate = Date.now();
  const totalTasks = taskManager.getAllTasks().length;
  const burndown = analytics.generateBurndown(startDate, endDate, totalTasks);
  res.json({ burndown });
});

app.get('/api/analytics/sprint-report', async (req, res) => {
  try {
    const sprintId = req.query.sprintId || 'current';
    const report = await taskManager.getSprintReport(sprintId);
    if (!report) return res.status(404).json({ error: 'Sprint not found' });
    res.json(report);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/analytics/time-report', (req, res) => {
  const { userId, startDate, endDate } = req.query;
  const report = analytics.getTimeReport(
    userId,
    startDate ? parseInt(startDate) : undefined,
    endDate ? parseInt(endDate) : undefined
  );
  res.json(report);
});

// Sprint APIs
app.post('/api/enhanced/sprints', async (req, res) => {
  try {
    const sprint = await taskManager.createSprint(
      req.body.name,
      req.body.days || 14
    );
    res.json(sprint);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============== Cognitive Load APIs (Phase 1-3) ==============

// Phase 1: Progress Memory APIs
app.get('/api/cognitive/progress/:userId', (req, res) => {
  const position = taskManager.getUserPosition(req.params.userId);
  res.json(position || { userId: req.params.userId });
});

app.post('/api/cognitive/progress/:userId', (req, res) => {
  taskManager.saveUserPosition(req.params.userId, req.body);
  res.json({ success: true });
});

app.post('/api/cognitive/progress/:userId/mark-session/:sessionId', (req, res) => {
  taskManager.markSessionAccessed(req.params.userId, req.params.sessionId);
  res.json({ success: true });
});

app.get('/api/cognitive/progress/:userId/suggest-next', (req, res) => {
  const nextSession = taskManager.suggestNextSession(req.params.userId);
  res.json({ suggestedSessionId: nextSession });
});

// Phase 2: AI Summarizer APIs
app.get('/api/cognitive/summaries/sessions', async (req, res) => {
  try {
    const { sessionIds } = req.query;
    const ids = sessionIds ? sessionIds.split(',') : undefined;
    const summaries = await taskManager.getSessionSummaries(ids);
    res.json({ summaries });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/cognitive/summaries/sessions/:sessionId', async (req, res) => {
  try {
    const summary = await taskManager.getSessionSummary(req.params.sessionId);
    if (!summary) return res.status(404).json({ error: 'Session not found' });
    res.json(summary);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/cognitive/summaries/tasks/:taskId', (req, res) => {
  const summary = taskManager.getTaskSummary(req.params.taskId);
  if (!summary) return res.status(404).json({ error: 'Task not found' });
  res.json(summary);
});

app.post('/api/cognitive/summaries/invalidate', (req, res) => {
  const { sessionId } = req.body;
  taskManager.invalidateSummaryCache(sessionId);
  res.json({ success: true });
});

// Phase 3: Confidence Scorer APIs
app.post('/api/cognitive/confidence/evaluate', (req, res) => {
  try {
    const result = taskManager.evaluateConfidence(req.body);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/cognitive/confidence/check', (req, res) => {
  const needsConfirm = taskManager.needsConfirmation(req.body);
  res.json({ needsConfirmation: needsConfirm });
});

app.get('/api/cognitive/confidence/history', (req, res) => {
  const limit = parseInt(req.query.limit) || 20;
  const history = taskManager.getChangeHistory(limit);
  res.json({ history });
});

app.get('/api/cognitive/confidence/pending', (req, res) => {
  const pending = taskManager.getPendingChanges();
  res.json({ pending });
});

app.post('/api/cognitive/confidence/confirm/:changeId', (req, res) => {
  const { confirmed, notes } = req.body;
  const success = taskManager.confirmChange(req.params.changeId, confirmed, notes);
  res.json({ success });
});

app.post('/api/cognitive/confidence/record', (req, res) => {
  const record = taskManager.recordChange(req.body);
  res.json(record);
});

app.get('/api/cognitive/confidence/colors', (req, res) => {
  const score = parseFloat(req.query.score) || 0.5;
  res.json({
    color: taskManager.getConfidenceColor(score),
    label: taskManager.getConfidenceLabel(score)
  });
});

// ============== Original Task APIs (Legacy) ==============

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

// ============== WebSocket ==============

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
  console.log(`   ${sessions.length} 个会话已注册`);
  console.log(`\n📊 新增API:`);
  console.log(`   /api/enhanced/sessions  - 会话管理`);
  console.log(`   /api/enhanced/tasks     - 增强任务`);
  console.log(`   /api/enhanced/boards   - 多看板`);
  console.log(`   /api/ai/*              - AI分析`);
  console.log(`   /api/webhooks/*        - Webhooks`);
  console.log(`   /api/analytics/*       - 数据分析`);
  console.log(`   /api/cognitive/*       - 三层负荷优化 (Phase 1-3)`);
  console.log();
});
