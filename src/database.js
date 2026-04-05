/**
 * OpenCode Task Hub - Database Module
 * SQLite persistence with migrations
 */

import path from 'path';
import fs from 'fs';
const SQLite = require('better-sqlite3');

class Database {
  constructor(dbPath) {
    this.dbPath = dbPath || path.join(process.cwd(), 'data', 'taskhub.db');
    
    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new SQLite(this.dbPath);
    this.db.pragma('journal_mode = WAL');
    this.initialize();
  }

  initialize() {
    this.createTables();
  }

  createTables() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        type TEXT NOT NULL DEFAULT 'task',
        parent_id TEXT,
        child_ids TEXT,
        agent_type TEXT,
        context_files TEXT,
        context_tasks TEXT,
        context_summary TEXT,
        key_decisions TEXT,
        blockers TEXT,
        tags TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        completed_at INTEGER,
        creator TEXT NOT NULL,
        assignees TEXT,
        priority TEXT DEFAULT 'medium',
        labels TEXT,
        custom_fields TEXT,
        FOREIGN KEY (parent_id) REFERENCES sessions(id)
      )
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT,
        status TEXT NOT NULL DEFAULT 'todo',
        priority TEXT NOT NULL DEFAULT 'medium',
        assignee TEXT,
        tags TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        estimated_hours REAL,
        actual_hours REAL,
        due_date INTEGER,
        session_id TEXT,
        subtasks TEXT,
        dependencies TEXT,
        linked_prs TEXT,
        comments TEXT,
        FOREIGN KEY (session_id) REFERENCES sessions(id)
      )
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS team_members (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        avatar TEXT,
        skills TEXT,
        availability INTEGER DEFAULT 100,
        current_tasks INTEGER DEFAULT 0,
        role TEXT DEFAULT 'developer',
        agent_sessions TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS time_entries (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        hours REAL NOT NULL,
        date INTEGER NOT NULL,
        description TEXT,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (task_id) REFERENCES tasks(id),
        FOREIGN KEY (user_id) REFERENCES team_members(id)
      )
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS artifacts (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        name TEXT NOT NULL,
        content TEXT NOT NULL,
        mime_type TEXT,
        created_by TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        session_id TEXT,
        task_id TEXT,
        shared INTEGER DEFAULT 0,
        FOREIGN KEY (session_id) REFERENCES sessions(id),
        FOREIGN KEY (task_id) REFERENCES tasks(id)
      )
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS webhooks (
        id TEXT PRIMARY KEY,
        url TEXT NOT NULL,
        events TEXT NOT NULL,
        secret TEXT,
        active INTEGER DEFAULT 1,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS notifications (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        message TEXT,
        user_id TEXT NOT NULL,
        read INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL,
        action_url TEXT,
        metadata TEXT
      )
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS analytics (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        data TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )
    `);

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
      CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON tasks(assignee);
      CREATE INDEX IF NOT EXISTS idx_tasks_session ON tasks(session_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
      CREATE INDEX IF NOT EXISTS idx_sessions_type ON sessions(type);
      CREATE INDEX IF NOT EXISTS idx_sessions_parent ON sessions(parent_id);
      CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);
      CREATE INDEX IF NOT EXISTS idx_time_entries_task ON time_entries(task_id);
    `);
  }

  run(sql, params = []) {
    try {
      const stmt = this.db.prepare(sql);
      return stmt.run(...params);
    } catch (error) {
      console.error('Database run error:', error);
      throw error;
    }
  }

  get(sql, params = []) {
    try {
      const stmt = this.db.prepare(sql);
      return stmt.get(...params);
    } catch (error) {
      console.error('Database get error:', error);
      throw error;
    }
  }

  all(sql, params = []) {
    try {
      const stmt = this.db.prepare(sql);
      return stmt.all(...params);
    } catch (error) {
      console.error('Database all error:', error);
      throw error;
    }
  }

  getTasks() {
    return this.all('SELECT * FROM tasks ORDER BY created_at DESC');
  }

  getTaskById(id) {
    return this.get('SELECT * FROM tasks WHERE id = ?', [id]);
  }

  createTask(task) {
    this.run(`
      INSERT INTO tasks (
        id, title, description, status, priority, assignee, tags,
        created_at, updated_at, estimated_hours, actual_hours, due_date,
        session_id, subtasks, dependencies, linked_prs, comments
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      task.id,
      task.title,
      task.description,
      task.status,
      task.priority,
      task.assignee,
      JSON.stringify(task.tags || []),
      task.createdAt,
      task.updatedAt,
      task.estimatedHours,
      task.actualHours,
      task.dueDate,
      task.sessionId,
      JSON.stringify(task.subtasks || []),
      JSON.stringify(task.dependencies || []),
      JSON.stringify(task.linkedPRs || []),
      JSON.stringify(task.comments || [])
    ]);
  }

  updateTask(id, updates) {
    const fields = [];
    const values = [];

    Object.entries(updates).forEach(([key, value]) => {
      const dbKey = key.replace(/([A-Z])/g, '_$1').toLowerCase();
      fields.push(`${dbKey} = ?`);
      if (typeof value === 'object') {
        values.push(JSON.stringify(value));
      } else {
        values.push(value);
      }
    });

    fields.push('updated_at = ?');
    values.push(Date.now());
    values.push(id);

    this.run(`UPDATE tasks SET ${fields.join(', ')} WHERE id = ?`, values);
  }

  deleteTask(id) {
    this.run('DELETE FROM tasks WHERE id = ?', [id]);
  }

  getSessions() {
    return this.all('SELECT * FROM sessions ORDER BY created_at DESC');
  }

  getSessionById(id) {
    return this.get('SELECT * FROM sessions WHERE id = ?', [id]);
  }

  getTeamMembers() {
    return this.all('SELECT * FROM team_members ORDER BY name');
  }

  createTeamMember(member) {
    this.run(`
      INSERT INTO team_members (
        id, name, email, avatar, skills, availability,
        current_tasks, role, agent_sessions, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      member.id,
      member.name,
      member.email,
      member.avatar,
      JSON.stringify(member.skills || []),
      member.availability || 100,
      member.currentTasks || 0,
      member.role || 'developer',
      JSON.stringify(member.agentSessions || []),
      member.createdAt || Date.now(),
      member.updatedAt || Date.now()
    ]);
  }

  getTimeEntries(taskId) {
    if (taskId) {
      return this.all('SELECT * FROM time_entries WHERE task_id = ? ORDER BY date DESC', [taskId]);
    }
    return this.all('SELECT * FROM time_entries ORDER BY date DESC');
  }

  createTimeEntry(entry) {
    this.run(`
      INSERT INTO time_entries (id, task_id, user_id, hours, date, description, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [
      entry.id,
      entry.taskId,
      entry.userId,
      entry.hours,
      entry.date,
      entry.description,
      entry.createdAt || Date.now()
    ]);
  }

  getWebhooks() {
    return this.all('SELECT * FROM webhooks WHERE active = 1');
  }

  createWebhook(webhook) {
    this.run(`
      INSERT INTO webhooks (id, url, events, secret, active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [
      webhook.id,
      webhook.url,
      JSON.stringify(webhook.events),
      webhook.secret,
      webhook.active ? 1 : 0,
      Date.now(),
      Date.now()
    ]);
  }

  getNotifications(userId, unreadOnly = false) {
    const sql = unreadOnly 
      ? 'SELECT * FROM notifications WHERE user_id = ? AND read = 0 ORDER BY created_at DESC'
      : 'SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC';
    return this.all(sql, [userId]);
  }

  createNotification(notification) {
    this.run(`
      INSERT INTO notifications (id, type, title, message, user_id, read, created_at, action_url, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      notification.id,
      notification.type,
      notification.title,
      notification.message,
      notification.userId,
      notification.read ? 1 : 0,
      notification.createdAt || Date.now(),
      notification.actionUrl,
      JSON.stringify(notification.metadata || {})
    ]);
  }

  markNotificationRead(id) {
    this.run('UPDATE notifications SET read = 1 WHERE id = ?', [id]);
  }

  saveAnalytics(type, data) {
    this.run(`
      INSERT INTO analytics (id, type, data, created_at)
      VALUES (?, ?, ?, ?)
    `, [
      `analytics_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      type,
      JSON.stringify(data),
      Date.now()
    ]);
  }

  getAnalytics(type, limit = 30) {
    return this.all(
      'SELECT * FROM analytics WHERE type = ? ORDER BY created_at DESC LIMIT ?',
      [type, limit]
    );
  }

  close() {
    this.db.close();
  }

  backup(backupPath) {
    this.db.backup(backupPath);
  }
}

export { Database };
export default Database;
