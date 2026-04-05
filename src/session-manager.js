/**
 * OpenCode Task Hub - Session Manager
 * Tree-structured session management with checkpoints
 */

import { EventEmitter } from 'events';
import { 
  Session, SessionStatus, SessionType, SessionContext, 
  Checkpoint, AgentType, AgentSession, Artifact 
} from './types.js';
import { Database } from './database.js';

export class SessionManager extends EventEmitter {
  private sessions: Map<string, Session> = new Map();
  private agentSessions: Map<string, AgentSession> = new Map();
  private db: Database;

  constructor(db: Database) {
    super();
    this.db = db;
    this.loadSessions();
  }

  private async loadSessions(): Promise<void> {
    const rows = await this.db.all('SELECT * FROM sessions');
    for (const row of rows) {
      const session = this.rowToSession(row);
      this.sessions.set(session.id, session);
    }
  }

  private rowToSession(row: any): Session {
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      status: row.status as SessionStatus,
      type: row.type as SessionType,
      parentId: row.parent_id || undefined,
      childIds: row.child_ids ? JSON.parse(row.child_ids) : [],
      agentType: row.agent_type as AgentType || undefined,
      context: {
        files: row.context_files ? JSON.parse(row.context_files) : [],
        tasks: row.context_tasks ? JSON.parse(row.context_tasks) : [],
        artifacts: [],
        summary: row.context_summary || undefined,
        keyDecisions: row.key_decisions ? JSON.parse(row.key_decisions) : [],
        blockers: row.blockers ? JSON.parse(row.blockers) : []
      },
      checkpoints: [],
      tags: row.tags ? JSON.parse(row.tags) : [],
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      completedAt: row.completed_at || undefined,
      metadata: {
        creator: row.creator,
        assignees: row.assignees ? JSON.parse(row.assignees) : [],
        priority: row.priority || 'medium',
        labels: row.labels ? JSON.parse(row.labels) : [],
        customFields: row.custom_fields ? JSON.parse(row.custom_fields) : {}
      }
    };
  }

  // ============== Session CRUD ==============

  async createSession(data: {
    name: string;
    description?: string;
    type?: SessionType;
    parentId?: string;
    agentType?: AgentType;
    tags?: string[];
    creator: string;
    priority?: 'low' | 'medium' | 'high' | 'critical';
  }): Promise<Session> {
    const id = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const now = Date.now();

    const session: Session = {
      id,
      name: data.name,
      description: data.description || '',
      status: 'active',
      type: data.type || 'task',
      parentId: data.parentId,
      childIds: [],
      agentType: data.agentType,
      context: {
        files: [],
        tasks: [],
        artifacts: [],
        keyDecisions: [],
        blockers: []
      },
      checkpoints: [],
      tags: data.tags || [],
      createdAt: now,
      updatedAt: now,
      metadata: {
        creator: data.creator,
        assignees: [data.creator],
        priority: data.priority || 'medium',
        labels: [],
        customFields: {}
      }
    };

    // 如果有父会话，添加到父的childIds
    if (data.parentId) {
      const parent = this.sessions.get(data.parentId);
      if (parent) {
        parent.childIds.push(id);
        await this.updateSession(data.parentId, { childIds: parent.childIds });
      }
    }

    this.sessions.set(id, session);
    await this.saveSession(session);
    this.emit('session:created', session);

    return session;
  }

  async updateSession(id: string, updates: Partial<Session>): Promise<Session | null> {
    const session = this.sessions.get(id);
    if (!session) return null;

    Object.assign(session, updates, { updatedAt: Date.now() });
    await this.saveSession(session);
    this.emit('session:updated', session);

    return session;
  }

  async deleteSession(id: string): Promise<boolean> {
    const session = this.sessions.get(id);
    if (!session) return false;

    // 递归删除子会话
    for (const childId of session.childIds) {
      await this.deleteSession(childId);
    }

    // 从父会话中移除
    if (session.parentId) {
      const parent = this.sessions.get(session.parentId);
      if (parent) {
        parent.childIds = parent.childIds.filter(cid => cid !== id);
        await this.updateSession(session.parentId, { childIds: parent.childIds });
      }
    }

    this.sessions.delete(id);
    await this.db.run('DELETE FROM sessions WHERE id = ?', [id]);
    this.emit('session:deleted', id);

    return true;
  }

  getSession(id: string): Session | undefined {
    return this.sessions.get(id);
  }

  getAllSessions(): Session[] {
    return Array.from(this.sessions.values());
  }

  getSessionsByStatus(status: SessionStatus): Session[] {
    return this.getAllSessions().filter(s => s.status === status);
  }

  getSessionsByType(type: SessionType): Session[] {
    return this.getAllSessions().filter(s => s.type === type);
  }

  // 获取会话树
  getSessionTree(rootId?: string): any {
    const getNode = (session: Session) => ({
      ...session,
      children: session.childIds.map(cid => this.sessions.get(cid)).filter(Boolean).map(getNode)
    });

    if (rootId) {
      const root = this.sessions.get(rootId);
      return root ? getNode(root) : null;
    }

    // 返回所有根会话
    return this.getAllSessions()
      .filter(s => !s.parentId)
      .map(getNode);
  }

  // ============== Checkpoint Management ==============

  async createCheckpoint(sessionId: string, name: string, snapshot?: string): Promise<Checkpoint | null> {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    const checkpoint: Checkpoint = {
      id: `cp_${Date.now()}`,
      name,
      timestamp: Date.now(),
      context: { ...session.context },
      snapshot: snapshot || JSON.stringify(session.context)
    };

    session.checkpoints.push(checkpoint);
    await this.updateSession(sessionId, { checkpoints: session.checkpoints });
    this.emit('checkpoint:created', { sessionId, checkpoint });

    return checkpoint;
  }

  async restoreCheckpoint(sessionId: string, checkpointId: string): Promise<boolean> {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    const checkpoint = session.checkpoints.find(cp => cp.id === checkpointId);
    if (!checkpoint) return false;

    session.context = { ...checkpoint.context };
    session.updatedAt = Date.now();
    
    await this.saveSession(session);
    this.emit('session:restored', { sessionId, checkpointId });

    return true;
  }

  // ============== Context Management ==============

  async addArtifact(sessionId: string, artifact: Artifact): Promise<boolean> {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    session.context.artifacts.push(artifact);
    await this.updateSession(sessionId, { artifacts: session.context.artifacts });
    
    return true;
  }

  async addKeyDecision(sessionId: string, decision: string): Promise<boolean> {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    session.context.keyDecisions.push(decision);
    await this.updateSession(sessionId, { keyDecisions: session.context.keyDecisions });
    
    return true;
  }

  async addBlocker(sessionId: string, blocker: string): Promise<boolean> {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    session.context.blockers.push(blocker);
    await this.updateSession(sessionId, { blockers: session.context.blockers });
    
    return true;
  }

  async updateSummary(sessionId: string, summary: string): Promise<boolean> {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    session.context.summary = summary;
    await this.updateSession(sessionId, { summary });
    
    return true;
  }

  // ============== Agent Session Management ==============

  async createAgentSession(data: {
    agentType: AgentType;
    parentSession?: string;
    context?: Partial<SessionContext>;
  }): Promise<AgentSession> {
    const id = `agent_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const agentSession: AgentSession = {
      sessionId: id,
      agentType: data.agentType,
      parentSession: data.parentSession,
      subSessions: [],
      context: {
        files: [],
        tasks: [],
        artifacts: [],
        keyDecisions: [],
        blockers: [],
        ...data.context
      },
      checkpoints: [],
      lastHeartbeat: Date.now(),
      state: 'idle'
    };

    this.agentSessions.set(id, agentSession);

    // 如果有父会话，关联起来
    if (data.parentSession) {
      const parent = this.sessions.get(data.parentSession);
      if (parent) {
        parent.childIds.push(id);
        await this.updateSession(data.parentSession, { childIds: parent.childIds });
      }
    }

    this.emit('agent:created', agentSession);
    return agentSession;
  }

  async heartbeat(agentSessionId: string): Promise<void> {
    const agent = this.agentSessions.get(agentSessionId);
    if (agent) {
      agent.lastHeartbeat = Date.now();
    }
  }

  async updateAgentState(agentSessionId: string, state: AgentSession['state']): Promise<void> {
    const agent = this.agentSessions.get(agentSessionId);
    if (agent) {
      agent.state = state;
      this.emit('agent:state_changed', { agentSessionId, state });
    }
  }

  getAgentSession(id: string): AgentSession | undefined {
    return this.agentSessions.get(id);
  }

  getAgentSessionsByParent(parentSessionId: string): AgentSession[] {
    return Array.from(this.agentSessions.values())
      .filter(a => a.parentSession === parentSessionId);
  }

  // ============== Session Templates ==============

  getSessionTemplates(): Session[] {
    // 预设模板
    return [
      {
        id: 'template_sprint',
        name: 'Sprint',
        description: '迭代开发会话',
        status: 'active',
        type: 'sprint',
        childIds: [],
        context: { files: [], tasks: [], artifacts: [], keyDecisions: [], blockers: [] },
        checkpoints: [],
        tags: ['sprint'],
        createdAt: 0,
        updatedAt: 0,
        metadata: { creator: 'system', assignees: [], priority: 'high', labels: [], customFields: {} }
      },
      {
        id: 'template_code_review',
        name: 'Code Review',
        description: '代码审查会话',
        status: 'active',
        type: 'agent',
        childIds: [],
        context: { files: [], tasks: [], artifacts: [], keyDecisions: [], blockers: [] },
        checkpoints: [],
        tags: ['review', 'agent'],
        createdAt: 0,
        updatedAt: 0,
        metadata: { creator: 'system', assignees: [], priority: 'high', labels: [], customFields: {} }
      },
      {
        id: 'template_bug_fix',
        name: 'Bug Fix',
        description: 'Bug修复会话',
        status: 'active',
        type: 'task',
        childIds: [],
        context: { files: [], tasks: [], artifacts: [], keyDecisions: [], blockers: [] },
        checkpoints: [],
        tags: ['bug', 'fix'],
        createdAt: 0,
        updatedAt: 0,
        metadata: { creator: 'system', assignees: [], priority: 'critical', labels: [], customFields: {} }
      }
    ];
  }

  // ============== Persistence ==============

  private async saveSession(session: Session): Promise<void> {
    await this.db.run(`
      INSERT OR REPLACE INTO sessions (
        id, name, description, status, type, parent_id, child_ids,
        agent_type, context_files, context_tasks, context_summary,
        key_decisions, blockers, tags, created_at, updated_at,
        completed_at, creator, assignees, priority, labels, custom_fields
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      session.id,
      session.name,
      session.description,
      session.status,
      session.type,
      session.parentId || null,
      JSON.stringify(session.childIds),
      session.agentType || null,
      JSON.stringify(session.context.files),
      JSON.stringify(session.context.tasks),
      session.context.summary || null,
      JSON.stringify(session.context.keyDecisions),
      JSON.stringify(session.context.blockers),
      JSON.stringify(session.tags),
      session.createdAt,
      session.updatedAt,
      session.completedAt || null,
      session.metadata.creator,
      JSON.stringify(session.metadata.assignees),
      session.metadata.priority,
      JSON.stringify(session.metadata.labels),
      JSON.stringify(session.metadata.customFields)
    ]);
  }

  // ============== Search ==============

  searchSessions(query: string): Session[] {
    const lowerQuery = query.toLowerCase();
    return this.getAllSessions().filter(s => 
      s.name.toLowerCase().includes(lowerQuery) ||
      s.description.toLowerCase().includes(lowerQuery) ||
      s.tags.some(t => t.toLowerCase().includes(lowerQuery)) ||
      s.context.summary?.toLowerCase().includes(lowerQuery)
    );
  }
}
