/**
 * OpenCode Task Hub - Enhanced Types
 * Session Management + Agent Integration + Analytics
 */

// ============== Session Types ==============

export interface Session {
  id: string;
  name: string;
  description: string;
  status: SessionStatus;
  type: SessionType;
  parentId?: string;           // 父会话ID（支持树形结构）
  childIds: string[];          // 子会话IDs
  agentType?: AgentType;       // 关联的Agent类型
  context: SessionContext;
  checkpoints: Checkpoint[];    // 快照历史
  tags: string[];
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
  metadata: SessionMetadata;
}

export type SessionStatus = 'active' | 'paused' | 'completed' | 'archived';
export type SessionType = 'task' | 'sprint' | 'release' | 'agent' | 'custom';

export interface SessionContext {
  files: string[];
  tasks: string[];           // 关联的任务IDs
  artifacts: Artifact[];
  summary?: string;           // AI生成的摘要
  keyDecisions: string[];    // 关键决策记录
  blockers: string[];         // 当前阻碍
}

export interface Checkpoint {
  id: string;
  name: string;
  timestamp: number;
  context: SessionContext;
  snapshot: string;          // 完整的上下文快照
}

export interface SessionMetadata {
  creator: string;
  assignees: string[];
  priority: 'low' | 'medium' | 'high' | 'critical';
  labels: string[];
  customFields: Record<string, any>;
}

// ============== Agent Types ==============

export interface AgentSession {
  sessionId: string;
  agentType: AgentType;
  parentSession?: string;
  subSessions: string[];
  context: SessionContext;
  checkpoints: Checkpoint[];
  lastHeartbeat: number;
  state: AgentState;
}

export type AgentType = 'claude' | 'openclaw' | 'lxzclaw' | 'codex' | 'custom';
export type AgentState = 'idle' | 'thinking' | 'working' | 'error' | 'waiting';

export interface AgentMessage {
  id: string;
  from: string;
  to: string;
  content: string;
  type: 'request' | 'response' | 'notification' | 'broadcast';
  timestamp: number;
  read: boolean;
}

// ============== Task Types ==============

export interface Task {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: Priority;
  assignee?: string;
  tags: string[];
  createdAt: number;
  updatedAt: number;
  estimatedHours?: number;
  actualHours?: number;
  dueDate?: number;
  sessionId?: string;         // 关联的会话
  subtasks?: SubTask[];
  dependencies?: string[];    // 依赖的任务IDs
  linkedPRs?: string[];      // 关联的PRs
  comments?: TaskComment[];
}

export type TaskStatus = 'backlog' | 'todo' | 'in-progress' | 'in-review' | 'done' | 'blocked';
export type Priority = 'low' | 'medium' | 'high' | 'critical';

export interface SubTask {
  id: string;
  title: string;
  completed: boolean;
}

export interface TaskComment {
  id: string;
  author: string;
  content: string;
  createdAt: number;
  mentions?: string[];
}

// ============== Team Types ==============

export interface TeamMember {
  id: string;
  name: string;
  email: string;
  avatar?: string;
  skills: string[];
  availability: number;       // 0-100%
  currentTasks: number;
  role: TeamRole;
  agentSessions: string[];    // 关联的Agent会话
}

export type TeamRole = 'admin' | 'lead' | 'developer' | 'reviewer' | 'viewer';

// ============== Board Types ==============

export interface Board {
  id: string;
  name: string;
  type: BoardType;
  columns: BoardColumn[];
  filters: BoardFilter[];
  createdAt: number;
}

export type BoardType = 'kanban' | 'sprint' | 'release' | 'timeline';

export interface BoardColumn {
  id: string;
  name: string;
  status: TaskStatus;
  order: number;
  wipLimit?: number;          // WIP限制
  color?: string;
}

export interface BoardFilter {
  field: string;
  operator: 'equals' | 'contains' | 'gt' | 'lt';
  value: any;
}

// ============== Analytics Types ==============

export interface SprintMetrics {
  sprintId: string;
  startDate: number;
  endDate: number;
  totalTasks: number;
  completedTasks: number;
  totalPoints: number;
  completedPoints: number;
  velocity: number;
  burndown: BurndownPoint[];
  teamPerformance: TeamMemberMetrics[];
}

export interface BurndownPoint {
  date: number;
  remaining: number;
  ideal: number;
}

export interface TeamMemberMetrics {
  memberId: string;
  tasksCompleted: number;
  pointsCompleted: number;
  averageTaskDuration: number;
  efficiency: number;
}

export interface TimeEntry {
  id: string;
  taskId: string;
  userId: string;
  hours: number;
  date: number;
  description: string;
}

// ============== Integration Types ==============

export interface Webhook {
  id: string;
  url: string;
  events: WebhookEvent[];
  secret: string;
  active: boolean;
}

export type WebhookEvent = 
  | 'task.created' 
  | 'task.updated' 
  | 'task.completed' 
  | 'task.commented'
  | 'session.created'
  | 'session.completed'
  | 'sprint.started'
  | 'sprint.completed';

export interface GitHubIntegration {
  repo: string;
  prTaskMapping: Record<string, string>;  // PR -> Task
  autoSync: boolean;
}

export interface ExternalCalendar {
  id: string;
  name: string;
  type: 'google' | 'outlook' | 'apple';
  syncEnabled: boolean;
  lastSync?: number;
}

// ============== Artifact ==============

export interface Artifact {
  id: string;
  type: 'code' | 'document' | 'design' | 'test' | 'screenshot';
  name: string;
  content: string;
  mimeType: string;
  createdBy: string;
  createdAt: number;
  sessionId?: string;
  taskId?: string;
  shared: boolean;
}

// ============== Notification ==============

export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  userId: string;
  read: boolean;
  createdAt: number;
  actionUrl?: string;
  metadata?: Record<string, any>;
}

export type NotificationType = 
  | 'mention' 
  | 'assignment' 
  | 'deadline' 
  | 'comment' 
  | 'status_change' 
  | 'system';

// ============== Template Types ==============

export interface TaskTemplate {
  id: string;
  name: string;
  description: string;
  defaultPriority: Priority;
  tags: string[];
  checklist?: string[];      // 默认检查项
  estimatedHours?: number;
}

export interface SessionTemplate {
  id: string;
  name: string;
  description: string;
  type: SessionType;
  defaultTags: string[];
  context: Partial<SessionContext>;
  boards: Partial<Board>[];
}
