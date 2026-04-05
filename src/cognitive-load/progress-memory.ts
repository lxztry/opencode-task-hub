/**
 * Cognitive Load Module - Progress Memory
 * Phase 1: 进度连续性记忆 - 减少切换代价
 * 
 * 核心功能：记录用户上次查看的位置，下次打开直接恢复
 * 理论基础：Gloria Mark研究证实，任务切换后恢复专注平均需要23分15秒
 * 解决方案：让用户每次都从上次中断的地方继续，避免重新定位
 */

import { Database } from '../database.js';

export interface UserPosition {
  userId: string;
  lastSessionId?: string;
  lastTaskId?: string;
  lastViewType?: 'board' | 'list' | 'session' | 'analytics';
  lastFilter?: Record<string, any>;
  lastSortOrder?: string;
  lastGroupBy?: string;
  updatedAt: number;
}

export interface SessionReadProgress {
  sessionId: string;
  lastReadCheckpointId?: string;
  lastReadArtifactId?: string;
  readSegments: string[];  // 已读的任务段/检查点IDs
  lastReadAt: number;
}

export class ProgressMemory {
  private db: Database;

  constructor(db: Database) {
    this.db = db;
    this.ensureTable();
  }

  private ensureTable(): void {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS user_progress (
        user_id TEXT PRIMARY KEY,
        last_session_id TEXT,
        last_task_id TEXT,
        last_view_type TEXT,
        last_filter TEXT,
        last_sort_order TEXT,
        last_group_by TEXT,
        updated_at INTEGER NOT NULL
      )
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS session_read_progress (
        user_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        last_checkpoint_id TEXT,
        last_artifact_id TEXT,
        read_segments TEXT,
        last_read_at INTEGER NOT NULL,
        PRIMARY KEY (user_id, session_id)
      )
    `);
  }

  // ============== 用户位置记忆 ==============

  /**
   * 保存用户当前位置
   */
  saveUserPosition(position: UserPosition): void {
    this.db.run(`
      INSERT OR REPLACE INTO user_progress (
        user_id, last_session_id, last_task_id, last_view_type,
        last_filter, last_sort_order, last_group_by, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      position.userId,
      position.lastSessionId || null,
      position.lastTaskId || null,
      position.lastViewType || null,
      position.lastFilter ? JSON.stringify(position.lastFilter) : null,
      position.lastSortOrder || null,
      position.lastGroupBy || null,
      Date.now()
    ]);
  }

  /**
   * 获取用户上次位置
   */
  getUserPosition(userId: string): UserPosition | null {
    const row = this.db.get('SELECT * FROM user_progress WHERE user_id = ?', [userId]);
    if (!row) return null;

    return {
      userId: row.user_id,
      lastSessionId: row.last_session_id || undefined,
      lastTaskId: row.last_task_id || undefined,
      lastViewType: row.last_view_type || undefined,
      lastFilter: row.last_filter ? JSON.parse(row.last_filter) : undefined,
      lastSortOrder: row.last_sort_order || undefined,
      lastGroupBy: row.last_group_by || undefined,
      updatedAt: row.updated_at
    };
  }

  /**
   * 快速更新最后访问的Session（轻量操作）
   */
  markSessionAccessed(userId: string, sessionId: string): void {
    this.db.run(`
      INSERT INTO user_progress (user_id, last_session_id, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        last_session_id = excluded.last_session_id,
        updated_at = excluded.updated_at
    `, [userId, sessionId, Date.now()]);
  }

  /**
   * 清除用户位置记录
   */
  clearUserPosition(userId: string): void {
    this.db.run('DELETE FROM user_progress WHERE user_id = ?', [userId]);
  }

  // ============== Session 阅读进度 ==============

  /**
   * 记录Session阅读进度
   */
  saveSessionReadProgress(userId: string, sessionId: string, progress: Partial<SessionReadProgress>): void {
    const existing = this.getSessionReadProgress(userId, sessionId);
    
    const readSegments = progress.readSegments || existing?.readSegments || [];
    if (progress.readSegments) {
      // 合并已读段
      const merged = new Set([...readSegments, ...progress.readSegments]);
      progress.readSegments = Array.from(merged);
    }

    this.db.run(`
      INSERT OR REPLACE INTO session_read_progress (
        user_id, session_id, last_checkpoint_id, last_artifact_id,
        read_segments, last_read_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `, [
      userId,
      sessionId,
      progress.lastReadCheckpointId || existing?.lastReadCheckpointId || null,
      progress.lastReadArtifactId || existing?.lastReadArtifactId || null,
      JSON.stringify(progress.readSegments || []),
      Date.now()
    ]);
  }

  /**
   * 获取Session阅读进度
   */
  getSessionReadProgress(userId: string, sessionId: string): SessionReadProgress | null {
    const row = this.db.get(
      'SELECT * FROM session_read_progress WHERE user_id = ? AND session_id = ?',
      [userId, sessionId]
    );
    if (!row) return null;

    return {
      sessionId: row.session_id,
      lastReadCheckpointId: row.last_checkpoint_id || undefined,
      lastReadArtifactId: row.last_artifact_id || undefined,
      readSegments: row.read_segments ? JSON.parse(row.read_segments) : [],
      lastReadAt: row.last_read_at
    };
  }

  /**
   * 获取用户在所有Session的阅读进度摘要
   */
  getAllReadProgress(userId: string): SessionReadProgress[] {
    const rows = this.db.all(
      'SELECT * FROM session_read_progress WHERE user_id = ? ORDER BY last_read_at DESC',
      [userId]
    );

    return rows.map(row => ({
      sessionId: row.session_id,
      lastReadCheckpointId: row.last_checkpoint_id || undefined,
      lastReadArtifactId: row.last_artifact_id || undefined,
      readSegments: row.read_segments ? JSON.parse(row.read_segments) : [],
      lastReadAt: row.last_read_at
    }));
  }

  // ============== 工具方法 ==============

  /**
   * 获取推荐的下一步Session（基于阅读进度）
   * 优先级：
   * 1. 有未读内容的进行中Session
   * 2. 最近访问的Session
   * 3. 最早创建的未完成Session
   */
  suggestNextSession(userId: string, allSessions: { id: string; status: string; createdAt: number }[]): string | null {
    // 获取阅读进度
    const readProgress = this.getAllReadProgress(userId);
    const readProgressMap = new Map(readProgress.map(p => [p.sessionId, p]));

    // 找到有未读内容的进行中Session
    for (const session of allSessions) {
      if (session.status !== 'active') continue;
      const progress = readProgressMap.get(session.id);
      if (progress && progress.readSegments.length > 0) {
        // 有阅读记录但可能未读完
        return session.id;
      }
    }

    // 获取上次位置
    const lastPosition = this.getUserPosition(userId);
    if (lastPosition?.lastSessionId) {
      // 检查该Session是否还存在且未完成
      const lastSession = allSessions.find(s => s.id === lastPosition.lastSessionId);
      if (lastSession && lastSession.status !== 'completed' && lastSession.status !== 'archived') {
        return lastPosition.lastSessionId;
      }
    }

    // 返回最早的未完成Session
    const unfinished = allSessions
      .filter(s => s.status !== 'completed' && s.status !== 'archived')
      .sort((a, b) => a.createdAt - b.createdAt);

    return unfinished[0]?.id || null;
  }
}
