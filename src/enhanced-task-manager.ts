/**
 * OpenCode Task Hub - Enhanced Task Manager
 * Integrates: Sessions, AI Analysis, Webhooks, Analytics
 * 
 * Cognitive Load Optimization (Phase 1-3):
 * - Progress Memory: 进度连续性记忆
 * - AI Summarizer: AI上下文摘要
 * - Confidence Scorer: 置信度指标
 */

import { EventEmitter } from 'events';
import { Task, TaskStatus, Priority, Board, BoardColumn, Session, TeamMember } from './types.js';
import { Database } from './database.js';
import { SessionManager } from './session-manager.js';
import { AIEnhancer } from './ai-enhancer.js';
import { WebhookManager, webhookManager } from './webhook-manager.js';
import { Analytics } from './analytics.js';

// Cognitive Load Modules
import { ProgressMemory, AISummarizer, ConfidenceScorer, SOPManager, HumanDecisionBoundary } from './cognitive-load/index.js';
import type { SessionSummary, ConfidenceResult, UserPosition, SOP, SOPExecution, DecisionResult, DecisionRule } from './cognitive-load/index.js';

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

  // Cognitive Load Modules
  private progressMemory: ProgressMemory;
  private aiSummarizer: AISummarizer;
  private confidenceScorer: ConfidenceScorer;
  private sopManager: SOPManager;
  private humanDecisionBoundary: HumanDecisionBoundary;
  private sessionSummaryCache: Map<string, SessionSummary> = new Map();

  constructor(db: Database) {
    super();
    this.db = db;
    this.sessionManager = new SessionManager(db);
    this.aiEnhancer = new AIEnhancer();
    this.webhookManager = webhookManager;
    this.analytics = new Analytics();

    // Initialize Cognitive Load Modules
    this.progressMemory = new ProgressMemory(db);
    this.aiSummarizer = new AISummarizer();
    this.confidenceScorer = new ConfidenceScorer(db);
    this.sopManager = new SOPManager(db);
    this.humanDecisionBoundary = new HumanDecisionBoundary(db);

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

  // ============== Cognitive Load: Progress Memory (Phase 1) ==============

  /**
   * 保存用户当前位置（用于进度连续性）
   */
  saveUserPosition(userId: string, position: Partial<UserPosition>): void {
    const current = this.progressMemory.getUserPosition(userId) || { userId, updatedAt: Date.now() };
    this.progressMemory.saveUserPosition({
      ...current,
      ...position,
      updatedAt: Date.now()
    });
  }

  /**
   * 获取用户上次位置
   */
  getUserPosition(userId: string): UserPosition | null {
    return this.progressMemory.getUserPosition(userId);
  }

  /**
   * 标记Session被访问（快速方法）
   */
  markSessionAccessed(userId: string, sessionId: string): void {
    this.progressMemory.markSessionAccessed(userId, sessionId);
  }

  /**
   * 推荐下一个应该看的Session
   */
  suggestNextSession(userId: string): string | null {
    const sessions = this.sessionManager.getAllSessions().map(s => ({
      id: s.id,
      status: s.status,
      createdAt: s.createdAt
    }));
    return this.progressMemory.suggestNextSession(userId, sessions);
  }

  // ============== Cognitive Load: AI Context Summary (Phase 2) ==============

  /**
   * 获取Session的3句话摘要
   */
  async getSessionSummary(sessionId: string): Promise<SessionSummary | null> {
    // 检查缓存（5分钟内有效）
    const cached = this.sessionSummaryCache.get(sessionId);
    if (cached && Date.now() - cached.generatedAt < 5 * 60 * 1000) {
      return cached;
    }

    const session = this.sessionManager.getSession(sessionId);
    if (!session) return null;

    const summary = await this.aiSummarizer.summarizeSession(session);
    this.sessionSummaryCache.set(sessionId, summary);
    return summary;
  }

  /**
   * 批量获取Session摘要（用于Dashboard展示）
   */
  async getSessionSummaries(sessionIds?: string[]): Promise<SessionSummary[]> {
    const sessions = sessionIds
      ? sessionIds.map(id => this.sessionManager.getSession(id)).filter(Boolean) as Session[]
      : this.sessionManager.getAllSessions();

    return this.aiSummarizer.summarizeSessions(sessions, this.sessionSummaryCache);
  }

  /**
   * 获取Task的简短摘要
   */
  getTaskSummary(taskId: string): import('./cognitive-load/index.js').TaskSummary | null {
    const task = this.tasks.get(taskId);
    if (!task) return null;

    return this.aiSummarizer.summarizeTask(task);
  }

  /**
   * 刷新摘要缓存（当Session内容变化时调用）
   */
  invalidateSummaryCache(sessionId?: string): void {
    if (sessionId) {
      this.sessionSummaryCache.delete(sessionId);
    } else {
      this.sessionSummaryCache.clear();
    }
  }

  // ============== Cognitive Load: Confidence Scorer (Phase 3) ==============

  /**
   * 评估AI输出的置信度
   */
  evaluateConfidence(context: {
    sessionId?: string;
    taskId?: string;
    outputType: 'summary' | 'suggestion' | 'code' | 'decision' | 'task-creation' | 'delete' | 'execute';
    outputContent?: string;
  }): ConfidenceResult {
    const session = context.sessionId ? this.sessionManager.getSession(context.sessionId) : undefined;
    const task = context.taskId ? this.tasks.get(context.taskId) : undefined;

    return this.confidenceScorer.evaluateConfidence({
      session,
      task,
      outputType: context.outputType,
      outputContent: context.outputContent
    });
  }

  /**
   * 检查是否需要人工确认
   */
  needsConfirmation(context: {
    outputType: string;
    outputContent?: string;
  }): boolean {
    return this.confidenceScorer.needsConfirmation(context);
  }

  /**
   * 记录一次变更（用于追踪历史）
   */
  recordChange(change: {
    actionType: 'create' | 'update' | 'delete' | 'execute';
    targetType: 'task' | 'session' | 'file' | 'code' | 'artifact';
    targetId: string;
    targetName: string;
    beforeState?: any;
    afterState?: any;
    confidence: number;
  }): import('./cognitive-load/index.js').ChangeRecord {
    return this.confidenceScorer.recordChange(change);
  }

  /**
   * 确认或拒绝变更
   */
  confirmChange(changeId: string, confirmed: boolean, notes?: string): boolean {
    return this.confidenceScorer.confirmChange(changeId, confirmed, notes);
  }

  /**
   * 获取变更历史
   */
  getChangeHistory(limit = 20): import('./cognitive-load/index.js').ChangeRecord[] {
    return this.confidenceScorer.getChangeHistory(limit);
  }

  /**
   * 获取待确认的变更
   */
  getPendingChanges(): import('./cognitive-load/index.js').ChangeRecord[] {
    return this.confidenceScorer.getPendingChanges();
  }

  /**
   * 获取置信度颜色（用于UI显示）
   */
  getConfidenceColor(score: number): string {
    return this.confidenceScorer.getConfidenceColor(score);
  }

  /**
   * 获取置信度标签
   */
  getConfidenceLabel(score: number): string {
    return this.confidenceScorer.getConfidenceLabel(score);
  }

  // ============== Getters for Cognitive Load Modules ==============

  getProgressMemory(): ProgressMemory {
    return this.progressMemory;
  }

  getAISummarizer(): AISummarizer {
    return this.aiSummarizer;
  }

  getConfidenceScorer(): ConfidenceScorer {
    return this.confidenceScorer;
  }

  // ============== Phase 4: SOP Manager ==============

  getSOPManager(): SOPManager {
    return this.sopManager;
  }

  getAllSOPs(): SOP[] {
    return this.sopManager.getAllSOPs();
  }

  getEnabledSOPs(): SOP[] {
    return this.sopManager.getEnabledSOPs();
  }

  matchSOP(context: { tags?: string[]; priority?: string; title?: string }): SOP | null {
    return this.sopManager.matchSOP(context);
  }

  startSOPExecution(sopId: string, context: { taskId?: string; sessionId?: string }): SOPExecution | null {
    return this.sopManager.startExecution(sopId, context);
  }

  getSOPExecution(id: string): SOPExecution | null {
    return this.sopManager.getExecution(id);
  }

  getRunningSOPExecutions(): SOPExecution[] {
    return this.sopManager.getRunningExecutions();
  }

  advanceSOPStep(executionId: string): boolean {
    return this.sopManager.advanceStep(executionId);
  }

  createSOP(data: Parameters<SOPManager['createSOP']>[0]): SOP {
    return this.sopManager.createSOP(data);
  }

  // ============== Phase 4: Human Decision Boundary ==============

  getHumanDecisionBoundary(): HumanDecisionBoundary {
    return this.humanDecisionBoundary;
  }

  evaluateHumanDecision(context: {
    type: string;
    target: string;
    details: string;
    sessionId?: string;
    taskId?: string;
  }): DecisionResult {
    return this.humanDecisionBoundary.evaluate(context);
  }

  quickDecisionCheck(operationType: string, details: string): DecisionResult {
    return this.humanDecisionBoundary.quickCheck(operationType, details);
  }

  getDecisionRules(): DecisionRule[] {
    return this.humanDecisionBoundary.getAllRules();
  }

  getConfirmationRequiredRules(): DecisionRule[] {
    return this.humanDecisionBoundary.getConfirmationRequiredRules();
  }

  confirmDecision(logId: string, confirmedBy: string, notes?: string): boolean {
    return this.humanDecisionBoundary.confirmDecision(logId, confirmedBy, notes);
  }

  getPendingDecisions(): any[] {
    return this.humanDecisionBoundary.getPendingDecisions();
  }

  // ============== Getters for Phase 4 ==============

  getSOPManagerInstance(): SOPManager {
    return this.sopManager;
  }

  getHumanDecisionBoundaryInstance(): HumanDecisionBoundary {
    return this.humanDecisionBoundary;
  }
}
