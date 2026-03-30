import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import express from 'express';
import cors from 'cors';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'http';

const PORT = 3031;
const BASE_URL = `http://localhost:${PORT}`;
const API_KEY = 'test-api-key';

let server;
let wss;
let sessions = [];
let tasks = [];
let idCounter = 1;

function createTestServer(requireAuth = false) {
  sessions = [];
  tasks = [];
  idCounter = 1;
  
  const app = express();
  app.use(cors());
  app.use(express.json());
  
  const authenticate = (req, res, next) => {
    if (!requireAuth) return next();
    const providedKey = req.headers['x-api-key'] || req.query.apiKey;
    if (providedKey !== API_KEY) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
  };
  
  app.use('/api/sessions', authenticate);
  app.use('/api/tasks', authenticate);
  
  app.get('/api/sessions', (req, res) => {
    const sessionsWithRate = sessions.map(s => ({
      ...s,
      tokenRate: { perSecond: 0, perMinute: 0 }
    }));
    res.json({ sessions: sessionsWithRate, tokenUsageSummary: { totalTokens: 0, totalInputTokens: 0, totalOutputTokens: 0 } });
  });
  app.post('/api/sessions/register', (req, res) => {
    const session = {
      id: String(idCounter++),
      sessionId: req.body.sessionId,
      projectPath: req.body.projectPath,
      projectName: req.body.projectName,
      projectKey: `${req.body.hostname}:${req.body.projectPath}`,
      hostname: req.body.hostname || 'localhost',
      status: 'active',
      createdAt: new Date().toISOString(),
      lastHeartbeat: new Date().toISOString(),
      tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, conversationCount: 0, history: [] }
    };
    sessions.push(session);
    res.json(session);
  });
  app.post('/api/sessions/:id/heartbeat', (req, res) => {
    const session = sessions.find(s => s.id === req.params.id || s.sessionId === req.params.id);
    if (session) {
      session.lastHeartbeat = new Date().toISOString();
      session.status = 'active';
    }
    res.json({ ok: !!session });
  });
  app.post('/api/sessions/:id/log', (req, res) => {
    const session = sessions.find(s => s.id === req.params.id || s.sessionId === req.params.id);
    if (session) {
      session.lastActivity = req.body.description || '进行中';
      if (!session.activities) session.activities = [];
      session.activities.unshift({ description: req.body.description, timestamp: new Date().toISOString() });
    }
    res.json({ ok: !!session });
  });
  app.post('/api/sessions/:id/token-usage', (req, res) => {
    const session = sessions.find(s => s.id === req.params.id || s.sessionId === req.params.id || s.projectKey === req.body.projectKey);
    if (session) {
      if (!session.tokenUsage) session.tokenUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0, conversationCount: 0, history: [] };
      const { inputTokens, outputTokens, totalTokens: bodyTotalTokens } = req.body;
      if (typeof bodyTotalTokens === 'number') {
        session.tokenUsage.totalTokens = bodyTotalTokens;
      } else {
        const inc = (inputTokens || 0) + (outputTokens || 0);
        session.tokenUsage.inputTokens += inputTokens || 0;
        session.tokenUsage.outputTokens += outputTokens || 0;
        session.tokenUsage.totalTokens += inc;
      }
      session.tokenUsage.history.push({ timestamp: Date.now(), tokens: (inputTokens || 0) + (outputTokens || 0) });
      session.tokenUsage.conversationCount = Math.max(session.tokenUsage.conversationCount || 0, req.body.conversationCount || 0);
    }
    res.json({ ok: !!session });
  });
  app.delete('/api/sessions/:id', (req, res) => {
    const idx = sessions.findIndex(s => s.id === req.params.id || s.sessionId === req.params.id);
    if (idx !== -1) sessions.splice(idx, 1);
    res.json({ ok: true });
  });
  app.get('/api/tasks', (req, res) => res.json({ tasks, sessions }));
  app.post('/api/tasks', (req, res) => {
    const task = { id: String(idCounter++), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), ...req.body };
    tasks.push(task);
    res.json(task);
  });
  app.put('/api/tasks/:id', (req, res) => {
    const idx = tasks.findIndex(t => t.id === req.params.id);
    if (idx !== -1) { tasks[idx] = { ...tasks[idx], ...req.body, updatedAt: new Date().toISOString() }; }
    res.json({ id: req.params.id, ...req.body });
  });
  app.delete('/api/tasks/:id', (req, res) => {
    const idx = tasks.findIndex(t => t.id === req.params.id);
    if (idx !== -1) tasks.splice(idx, 1);
    res.json({ ok: true });
  });
  app.post('/api/tasks/:id/assign', (req, res) => res.json({ id: req.params.id, sessionId: req.body.sessionId }));
  
  server = createServer(app);
  wss = new WebSocketServer({ server });
}

describe('API Tests', () => {
  before(() => {
    createTestServer();
    return new Promise((resolve) => server.listen(PORT, () => resolve()));
  });

  after(() => {
    return new Promise((resolve) => {
      wss.close();
      server.close(() => resolve());
    });
  });

  test('GET /api/sessions returns empty array initially', async () => {
    const res = await fetch(`${BASE_URL}/api/sessions`);
    const data = await res.json();
    assert.strictEqual(Array.isArray(data.sessions), true);
  });

  test('POST /api/sessions/register creates a session', async () => {
    const res = await fetch(`${BASE_URL}/api/sessions/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: 'test-session-1',
        projectPath: '/test/project',
        projectName: 'test-project'
      })
    });
    const session = await res.json();
    assert.strictEqual(session.sessionId, 'test-session-1');
    assert.strictEqual(session.projectName, 'test-project');
  });

  test('POST /api/sessions/:id/heartbeat succeeds', async () => {
    const res = await fetch(`${BASE_URL}/api/sessions/1/heartbeat`, { method: 'POST' });
    const data = await res.json();
    assert.strictEqual(data.ok, true);
  });

  test('POST /api/sessions/:id/log succeeds', async () => {
    const res = await fetch(`${BASE_URL}/api/sessions/1/log`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: 'Test activity' })
    });
    const data = await res.json();
    assert.strictEqual(data.ok, true);
  });

  test('DELETE /api/sessions/:id succeeds', async () => {
    const res = await fetch(`${BASE_URL}/api/sessions/1`, { method: 'DELETE' });
    const data = await res.json();
    assert.strictEqual(data.ok, true);
  });

  test('GET /api/tasks returns empty array initially', async () => {
    const res = await fetch(`${BASE_URL}/api/tasks`);
    const data = await res.json();
    assert.strictEqual(Array.isArray(data.tasks), true);
  });

  test('POST /api/tasks creates a task', async () => {
    const res = await fetch(`${BASE_URL}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Test Task', status: 'pending' })
    });
    const task = await res.json();
    assert.strictEqual(task.title, 'Test Task');
    assert.strictEqual(task.status, 'pending');
  });

  test('PUT /api/tasks/:id updates a task', async () => {
    const res = await fetch(`${BASE_URL}/api/tasks/1`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'completed' })
    });
    const task = await res.json();
    assert.strictEqual(task.status, 'completed');
  });

  test('POST /api/tasks/:id/assign assigns task to session', async () => {
    const res = await fetch(`${BASE_URL}/api/tasks/1/assign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: 'session-1' })
    });
    const task = await res.json();
    assert.strictEqual(task.sessionId, 'session-1');
  });

  test('DELETE /api/tasks/:id succeeds', async () => {
    const res = await fetch(`${BASE_URL}/api/tasks/1`, { method: 'DELETE' });
    const data = await res.json();
    assert.strictEqual(data.ok, true);
  });

  test('WebSocket connection receives initial state', (t, done) => {
    const ws = new WebSocket(`ws://localhost:${PORT}`);
    ws.on('message', (data) => {
      const msg = JSON.parse(data);
      assert.strictEqual(msg.type, 'connected');
      assert.ok(Array.isArray(msg.sessions));
      assert.ok(Array.isArray(msg.tasks));
      ws.close();
      done();
    });
  });

  test('Session registration accepts partial data', async () => {
    const res = await fetch(`${BASE_URL}/api/sessions/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectPath: '/test' })
    });
    const session = await res.json();
    assert.strictEqual(session.projectPath, '/test');
  });

  test('Task creation accepts partial data', async () => {
    const res = await fetch(`${BASE_URL}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'pending' })
    });
    const task = await res.json();
    assert.strictEqual(task.status, 'pending');
  });

  test('POST /api/sessions/:id/token-usage updates token counts', async () => {
    await fetch(`${BASE_URL}/api/sessions/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: 'token-test-session', projectPath: '/test', projectName: 'test' })
    });
    
    const res = await fetch(`${BASE_URL}/api/sessions/token-test-session/token-usage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ inputTokens: 1000, outputTokens: 500 })
    });
    const data = await res.json();
    assert.strictEqual(data.ok, true);
    
    const sessionsRes = await fetch(`${BASE_URL}/api/sessions`);
    const sessionsData = await sessionsRes.json();
    const session = sessionsData.sessions.find(s => s.sessionId === 'token-test-session');
    assert.strictEqual(session.tokenUsage.inputTokens, 1000);
    assert.strictEqual(session.tokenUsage.outputTokens, 500);
    assert.strictEqual(session.tokenUsage.totalTokens, 1500);
  });

  test('POST /api/sessions/:id/token-usage accepts totalTokens', async () => {
    const res = await fetch(`${BASE_URL}/api/sessions/token-test-session/token-usage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ totalTokens: 3000 })
    });
    const data = await res.json();
    assert.strictEqual(data.ok, true);
    
    const sessionsRes = await fetch(`${BASE_URL}/api/sessions`);
    const sessionsData = await sessionsRes.json();
    const session = sessionsData.sessions.find(s => s.sessionId === 'token-test-session');
    assert.strictEqual(session.tokenUsage.totalTokens, 3000);
  });
});

describe('Authentication Tests', () => {
  before(() => {
    createTestServer(true);
    return new Promise((resolve) => server.listen(PORT + 1, () => resolve()));
  });

  after(() => {
    return new Promise((resolve) => {
      wss.close();
      server.close(() => resolve());
    });
  });

  test('API requests without key are rejected', async () => {
    const res = await fetch(`http://localhost:${PORT + 1}/api/sessions`);
    assert.strictEqual(res.status, 401);
  });

  test('API requests with valid key succeed', async () => {
    const res = await fetch(`http://localhost:${PORT + 1}/api/sessions?apiKey=${API_KEY}`);
    assert.strictEqual(res.status, 200);
  });

  test('API requests with header key succeed', async () => {
    const res = await fetch(`http://localhost:${PORT + 1}/api/sessions`, {
      headers: { 'x-api-key': API_KEY }
    });
    assert.strictEqual(res.status, 200);
  });
});
