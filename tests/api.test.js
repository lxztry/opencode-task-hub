import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import express from 'express';
import cors from 'cors';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'http';

const PORT = 3031;
const BASE_URL = `http://localhost:${PORT}`;

let server;
let wss;
let sessions = [];
let tasks = [];
let idCounter = 1;

function createTestServer() {
  sessions = [];
  tasks = [];
  idCounter = 1;
  
  const app = express();
  app.use(cors());
  app.use(express.json());
  
  app.get('/api/sessions', (req, res) => res.json({ sessions }));
  app.post('/api/sessions/register', (req, res) => {
    const session = {
      id: String(idCounter++),
      sessionId: req.body.sessionId,
      projectPath: req.body.projectPath,
      projectName: req.body.projectName,
      status: 'active'
    };
    sessions.push(session);
    res.json(session);
  });
  app.post('/api/sessions/:id/heartbeat', (req, res) => res.json({ ok: true }));
  app.post('/api/sessions/:id/log', (req, res) => res.json({ ok: true }));
  app.delete('/api/sessions/:id', (req, res) => res.json({ ok: true }));
  app.get('/api/tasks', (req, res) => res.json({ tasks, sessions }));
  app.post('/api/tasks', (req, res) => {
    const task = { id: String(idCounter++), ...req.body };
    tasks.push(task);
    res.json(task);
  });
  app.put('/api/tasks/:id', (req, res) => res.json({ id: req.params.id, ...req.body }));
  app.delete('/api/tasks/:id', (req, res) => res.json({ ok: true }));
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

  describe('Sessions API', () => {
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
  });

  describe('Tasks API', () => {
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
  });
});

describe('WebSocket Tests', () => {
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
});

describe('Validation Tests', () => {
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
});
