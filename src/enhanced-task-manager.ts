/**
 * OpenCode Task Hub - Enhanced Task Manager
 * Integrates: Sessions, AI Analysis, Webhooks, Analytics
 */

import { EventEmitter } from 'events';
import { Task, TaskStatus, Priority, Board, BoardColumn, Session, TeamMember } from './types.js';
import { Database } from './database.js';
import { SessionManager } from './session-manager.js';
import { AIEnhancer } from './ai-enhancer.js';
import { WebhookManager, webhookManager } from './webhook-manager.js';
import { Analytics } from './analytics.js';

export interface BoardView {
  id: string;
  name: string;
  type: 'kanban' | 'sprint' | 'release' | 'timeline';
  columns: {
    id: string;
    name: string;
    status: TaskStatus;
    tasks: Task[];
    wipLimit?: number;
  }[];
  filters: {
    assignee?: string;
    priority?: Priority;
    tags?: string[];
    search?: string;
  };
}

export class EnhancedTaskManager extends EventEmitter {
  private tasks: Map<string, Task> = new Map();
  private boards: Map<string, BoardView> = new Map();
  private db: Database;
  private sessionManager: SessionManager;
  private aiEnhancer: AIEnhancer;
  private webhookManager: WebhookManager;
  private analytics: Analytics;

  constructor(db: Database) {
    super();
    this.db = db;
    this.sessionManager = new SessionManager(db);
    this.aiEnhancer = new AIEnhancer();
    this.webhookManager = webhookManager;
    this.analytics = new Analytics();

    this.initialize();
  }

  private async initialize(): Promise<void> {
    await this.loadTasks();
    this.setupDefaultBoard();
    this.setupEventListeners();
  }

  private async loadTasks(): Promise<void> {
    const rows = this.db.getTasks();
    for (const row of rows) {
      const task = this.rowToTask(row);
      this.tasks.set(task.id, task);
    }
  }

  private rowToTask(row: any): Task {
    return {
      id: row.id,
      title: row.title,
      description: row.description,
      status: row.status as TaskStatus,
      priority: row.priority as Priority,
      assignee: row.assignee,
      tags: row.tags ? JSON.parse(row.tags) : [],
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      estimatedHours: row.estimated_hours,
      actualHours: row.actual_hours,
      dueDate: row.due_date,
      sessionId: row.session_id,
      subtasks: row.subtasks ? JSON.parse(row.subtasks) : [],
      dependencies: row.dependencies ? JSON.parse(row.dependencies) : [],
      linkedPRs: row.linked_prs ? JSON.parse(row.linked_prs) : [],
      comments: row.comments ? JSON.parse(row.comments) : []
    };
  }

  private setupDefaultBoard(): void {
    const board: BoardView = {
      id: 'default',
      name: 'Main Board',
      type: 'kanban',
      columns: [
        { id: 'backlog', name: 'Backlog', status: 'backlog', tasks: [] },
        { id: 'todo', name: 'To Do', status: 'todo', tasks: [] },
        { id: 'in-progress', name: 'In Progress', status: 'in-progress', tasks: [], wipLimit: 5 },
        { id: 'in-review', name: 'In Review', status: 'in-review', tasks: [] },
        { id: 'done', name: 'Done', status: 'done', tasks: [] }
      ],
      filters: {}
    };

    this.boards.set(board.id, board);
    this.refreshBoardView('default');
  }

  private setupEventListeners(): void {
    // 同步数据到 analytics
    this.on('task:created', () => this.syncAnalytics());
    this.on('task:updated', () => this.syncAnalytics());
    this.on('task:deleted', () => this.syncAnalytics());
  }

  private syncAnalytics(): void {
    this.analytics.updateData(
      this.getAllTasks(),
      [], // timeEntries
      [], // teamMembers
      this.sessionManager.getAllSessions()
    );
  }

  // ============== Task CRUD ==============

  async createTask(data: {
    title: string;
    description?: string;
    priority?: Priority;
    assignee?: string;
    tags?: string[];
    sessionId?: string;
    estimatedHours?: number;
    dueDate?: number;
  }): Promise<Task> {
    const id = `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const now = Date.now();

    const task: Task = {
      id,
      title: data.title,
      description: data.description || '',
      status: 'todo',
      priority: data.priority || 'medium',
      assignee: data.assignee,
      tags: data.tags || [],
      createdAt: now,
      updatedAt: now,
      estimatedHours: data.estimatedHours,
      dueDate: data.dueDate,
      sessionId: data.sessionId,
      subtasks: [],
      dependencies: [],
      linkedPRs: [],
      comments: []
    };

    this.tasks.set(id, task);
    this.db.createTask(task);
    
    // AI 分析
    const analysis = await this.aiEnhancer.analyzeTask(task);
    task.estimatedHours = analysis.suggestedEstimate;
    
    // 触发事件
    this.emit('task:created', task);
    await this.webhookManager.onTaskCreated(task);
    
    // 刷新看板
    this.refreshAllBoards();

    return task;
  }

  async updateTask(id: string, updates: Partial<Task>): Promise<Task | null> {
    const task = this.tasks.get(id);
    if (!task) return null;

    const oldStatus = task.status;
    
    Object.assign(task, updates, { updatedAt: Date.now() });
    this.db.updateTask(id, updates);
    
    // 状态变更事件
    if (updates.status && updates.status !== oldStatus) {
      this.emit('task:status_changed', { task, oldStatus, newStatus: updates.status });
      
      if (updates.status === 'done') {
        await this.webhookManager.onTaskCompleted(task);
      }
    }

    this.emit('task:updated', task);
    await this.webhookManager.onTaskUpdated(task);
    this.refreshAllBoards();

    return task;
  }

  async deleteTask(id: string): Promise<boolean> {
    const task = this.tasks.get(id);
    if (!task) return false;

    this.tasks.delete(id);
    this.db.deleteTask(id);
    
    this.emit('task:deleted', id);
    this.refreshAllBoards();

    return true;
  }

  getTask(id: string): Task | undefined {
    return this.tasks.get(id);
  }

  getAllTasks(): Task[] {
    return Array.from(this.tasks.values());
  }

  // ============== Subtasks ==============

  async addSubtask(taskId: string, title: string): Promise<Task | null> {
    const task = this.tasks.get(taskId);
    if (!task) return null;

    const subtask = {
      id: `subtask_${Date.now()}`,
      title,
      completed: false
    };

    task.subtasks.push(subtask);
    await this.updateTask(taskId, { subtasks: task.subtasks });

    return task;
  }

  async toggleSubtask(taskId: string, subtaskId: string): Promise<Task | null> {
    const task = this.tasks.get(taskId);
    if (!task) return null;

    const subtask = task.subtasks.find(s => s.id === subtaskId);
    if (subtask) {
      subtask.completed = !subtask.completed;
      await this.updateTask(taskId, { subtasks: task.subtasks });
    }

    return task;
  }

  // ============== Comments ==============

  async addComment(taskId: string, author: string, content: string, mentions?: string[]): Promise<Task | null> {
    const task = this.tasks.get(taskId);
    if (!task) return null;

    const comment = {
      id: `comment_${Date.now()}`,
      author,
      content,
      createdAt: Date.now(),
      mentions
    };

    task.comments.push(comment);
    await this.updateTask(taskId, { comments: task.comments });
    
    await this.webhookManager.onTaskCommented(taskId, content, author);

    return task;
  }

  // ============== Board Views ==============

  getBoard(boardId: string): BoardView | undefined {
    return this.boards.get(boardId);
  }

  getAllBoards(): BoardView[] {
    return Array.from(this.boards.values());
  }

  refreshBoardView(boardId: string): void {
    const board = this.boards.get(boardId);
    if (!board) return;

    for (const column of board.columns) {
      column.tasks = this.getTasksByStatus(column.status, board.filters);
    }
  }

  refreshAllBoards(): void {
    for (const boardId of this.boards.keys()) {
      this.refreshBoardView(boardId);
    }
  }

  private getTasksByStatus(status: TaskStatus, filters: BoardView['filters']): Task[] {
    let tasks = this.getAllTasks().filter(t => t.status === status);

    if (filters.assignee) {
      tasks = tasks.filter(t => t.assignee === filters.assignee);
    }
    if (filters.priority) {
      tasks = tasks.filter(t => t.priority === filters.priority);
    }
    if (filters.tags && filters.tags.length > 0) {
      tasks = tasks.filter(t => filters.tags.some(tag => t.tags.includes(tag)));
    }
    if (filters.search) {
      const search = filters.search.toLowerCase();
      tasks = tasks.filter(t => 
        t.title.toLowerCase().includes(search) ||
        t.description.toLowerCase().includes(search)
      );
    }

    return tasks;
  }

  setBoardFilter(boardId: string, filters: BoardView['filters']): void {
    const board = this.boards.get(boardId);
    if (board) {
      board.filters = filters;
      this.refreshBoardView(boardId);
    }
  }

  createBoard(data: {
    name: string;
    type: BoardView['type'];
    columns?: { name: string; status: TaskStatus; wipLimit?: number }[];
  }): BoardView {
    const board: BoardView = {
      id: `board_${Date.now()}`,
      name: data.name,
      type: data.type,
      columns: (data.columns || [
        { id: 'todo', name: 'To Do', status: 'todo', tasks: [] },
        { id: 'in-progress', name: 'In Progress', status: 'in-progress', tasks: [], wipLimit: 5 },
        { id: 'done', name: 'Done', status: 'done', tasks: [] }
      ]).map((c, i) => ({ ...c, id: c.id || `col_${i}`, tasks: [] })),
      filters: {}
    };

    this.boards.set(board.id, board);
    this.refreshBoardView(board.id);

    return board;
  }

  // ============== Session Integration ==============

  getSessionManager(): SessionManager {
    return this.sessionManager;
  }

  async linkTaskToSession(taskId: string, sessionId: string): Promise<boolean> {
    const task = this.tasks.get(taskId);
    if (!task) return false;

    task.sessionId = sessionId;
    await this.updateTask(taskId, { sessionId });

    // 同时更新session的context
    if (!task.sessionId) return false;
    
    const session = this.sessionManager.getSession(sessionId);
    if (session) {
      if (!session.context.tasks.includes(taskId)) {
        session.context.tasks.push(taskId);
        await this.sessionManager.updateSession(sessionId, { tasks: session.context.tasks });
      }
    }

    return true;
  }

  getTasksBySession(sessionId: string): Task[] {
    return this.getAllTasks().filter(t => t.sessionId === sessionId);
  }

  // ============== AI Features ==============

  async suggestAssignee(taskId: string): Promise<{
    assigneeId: string;
    assigneeName: string;
    confidence: number;
    reason: string;
  } | null> {
    const task = this.tasks.get(taskId);
    if (!task) return null;

    // 获取团队成员
    const members = this.db.getTeamMembers().map(m => ({
      id: m.id,
      name: m.name,
      skills: JSON.parse(m.skills || '[]'),
      availability: m.availability,
      currentTasks: m.current_tasks
    }));

    return this.aiEnhancer.suggestAssignee(task, members);
  }

  async analyzeTask(taskId: string): Promise<{
    complexity: string;
    suggestedEstimate: number;
    potentialRisks: string[];
    skillRequirements: string[];
  } | null> {
    const task = this.tasks.get(taskId);
    if (!task) return null;

    return this.aiEnhancer.analyzeTask(task);
  }

  async parseNaturalLanguage(text: string): Promise<Partial<Task>> {
    return this.aiEnhancer.parseNaturalLanguage(text);
  }

  async generateSessionSummary(sessionId: string): Promise<string | null> {
    const session = this.sessionManager.getSession(sessionId);
    if (!session) return null;

    return this.aiEnhancer.generateSessionSummary(session);
  }

  async detectRisks(): Promise<any[]> {
    return this.aiEnhancer.detectRisks(
      this.getAllTasks(),
      this.sessionManager.getAllSessions()
    );
  }

  // ============== Sprint Features ==============

  async createSprint(name: string, days: number = 14): Promise<Session> {
    return this.sessionManager.createSession({
      name: `Sprint: ${name}`,
      description: `Sprint lasting ${days} days`,
      type: 'sprint',
      tags: [`sprint-${name.toLowerCase().replace(/\s+/g, '-')}`],
      creator: 'system',
      priority: 'high'
    });
  }

  getSprintTasks(sprintSessionId: string): Task[] {
    return this.getTasksBySession(sprintSessionId);
  }

  async getSprintReport(sprintSessionId: string): Promise<any> {
    const session = this.sessionManager.getSession(sprintSessionId);
    if (!session) return null;

    const days = 14; // 默认14天sprint
    const endDate = Date.now();
    const startDate = endDate - days * 86400000;

    return this.analytics.generateSprintReport(
      sprintSessionId,
      session.name,
      startDate,
      endDate
    );
  }

  // ============== Analytics ==============

  getAnalytics(): Analytics {
    this.syncAnalytics();
    return this.analytics;
  }

  async forecastSprint(teamSize: number, days: number): Promise<any> {
    return this.analytics.forecastSprint(this.getAllTasks(), teamSize, days);
  }

  // ============== Natural Language Task Creation ==============

  async createTaskFromText(text: string, creator: string): Promise<Task> {
    const parsed = await this.parseNaturalLanguage(text);
    
    return this.createTask({
      title: parsed.title || text,
      description: parsed.description || '',
      priority: parsed.priority || 'medium',
      tags: parsed.tags || [],
      dueDate: parsed.dueDate
    });
  }
}
