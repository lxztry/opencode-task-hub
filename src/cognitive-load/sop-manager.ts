/**
 * Cognitive Load Module - SOP Manager
 * Phase 4: 标准操作流程 (SOP) 化
 * 
 * 核心功能：用户为每类任务定义 SOP，AI 按 SOP 执行
 * 理论基础：减少临时判断，把 AI 从"协作伙伴"变成"听话的执行者"
 */

import { Database } from '../database.js';

export type SOPStepType = 'input' | 'process' | 'output' | 'verify' | 'approve';

export interface SOPStep {
  id: string;
  order: number;
  type: SOPStepType;
  name: string;
  description: string;
  prompt?: string;           // AI 执行步骤的 prompt
  expectedOutput?: string;    // 期望输出描述
  verifyRule?: string;       // 验收规则（自然语言）
  autoComplete?: boolean;    // 是否自动完成
  requiresApproval?: boolean; // 是否需要人工审批
}

export interface SOP {
  id: string;
  name: string;
  description: string;
  trigger: SOPTrigger;
  steps: SOPStep[];
  tags: string[];            // 关联的标签
  createdAt: number;
  updatedAt: number;
  enabled: boolean;
  usageCount: number;
  avgCompletionTime?: number; // 平均完成时间（分钟）
}

export interface SOPTrigger {
  type: 'tag' | 'keyword' | 'priority' | 'assignee' | 'all';
  /** 触发条件值 */
  value?: string;
  /** 优先级（仅 type=priority 时有效） */
  priority?: 'low' | 'medium' | 'high' | 'critical';
}

export interface SOPExecution {
  id: string;
  sopId: string;
  sopName: string;
  taskId?: string;
  sessionId?: string;
  status: 'running' | 'paused' | 'completed' | 'cancelled';
  currentStepIndex: number;
  stepResults: SOPStepResult[];
  startedAt: number;
  completedAt?: number;
  totalDuration?: number;    // 总耗时（毫秒）
}

export interface SOPStepResult {
  stepId: string;
  stepName: string;
  startedAt: number;
  completedAt?: number;
  output?: string;
  approved?: boolean;
  approvedBy?: string;
  notes?: string;
  confidence?: number;
  error?: string;
}

export class SOPManager {
  private db: Database;

  constructor(db: Database) {
    this.db = db;
    this.ensureTable();
    this.ensureDefaultSOPs();
  }

  private ensureTable(): void {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS sops (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        trigger TEXT NOT NULL,
        steps TEXT NOT NULL,
        tags TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        enabled INTEGER DEFAULT 1,
        usage_count INTEGER DEFAULT 0,
        avg_completion_time REAL
      )
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS sop_executions (
        id TEXT PRIMARY KEY,
        sop_id TEXT NOT NULL,
        sop_name TEXT NOT NULL,
        task_id TEXT,
        session_id TEXT,
        status TEXT NOT NULL DEFAULT 'running',
        current_step_index INTEGER DEFAULT 0,
        step_results TEXT,
        started_at INTEGER NOT NULL,
        completed_at INTEGER,
        total_duration INTEGER
      )
    `);
  }

  private ensureDefaultSOPs(): void {
    const existing = this.db.all('SELECT COUNT(*) as count FROM sops');
    if (existing[0]?.count > 0) return;

    // 创建几个默认 SOP
    const defaultSOPs: Partial<SOP>[] = [
      {
        name: 'Bug 修复流程',
        description: '标准 Bug 修复流程：复现 → 定位 → 修复 → 验证',
        trigger: { type: 'tag', value: 'bug' },
        tags: ['bug', 'fix'],
        steps: [
          { id: 's1', order: 1, type: 'input', name: '复现问题', description: '确认 Bug 可复现，收集复现步骤', prompt: '请复现并描述这个问题，确认触发条件' },
          { id: 's2', order: 2, type: 'process', name: '定位根因', description: '分析代码找出问题根源', prompt: '分析代码历史和相关文件，找出 Bug 的根本原因' },
          { id: 's3', order: 3, type: 'output', name: '实施修复', description: '编写修复代码', prompt: '根据根因分析，实施代码修复' },
          { id: 's4', order: 4, type: 'verify', name: '验证修复', description: '确认 Bug 已修复且无副作用', prompt: '重新执行复现步骤，确认问题已解决' }
        ]
      },
      {
        name: '新功能开发',
        description: '标准功能开发流程：需求确认 → 设计 → 实现 → 测试 → 文档',
        trigger: { type: 'tag', value: 'feature' },
        tags: ['feature', 'development'],
        steps: [
          { id: 's1', order: 1, type: 'input', name: '理解需求', description: '明确功能需求和验收标准', prompt: '分析功能需求，列出关键实现点' },
          { id: 's2', order: 2, type: 'process', name: '方案设计', description: '设计实现方案', prompt: '设计技术实现方案，包括数据结构、接口设计' },
          { id: 's3', order: 3, type: 'output', name: '代码实现', description: '编写功能代码', prompt: '按照设计方案实现功能代码' },
          { id: 's4', order: 4, type: 'verify', name: '单元测试', description: '编写和运行测试', prompt: '编写单元测试用例并运行，确保覆盖率' },
          { id: 's5', order: 5, type: 'output', name: '更新文档', description: '更新相关文档', prompt: '更新 README、API 文档或内嵌注释' }
        ]
      },
      {
        name: '代码审查',
        description: '标准代码审查流程：自检 → 提交审查 → 修复意见 → 合并',
        trigger: { type: 'tag', value: 'review' },
        tags: ['review', 'code-review'],
        steps: [
          { id: 's1', order: 1, type: 'verify', name: '自检代码', description: '自我审查代码质量', prompt: '检查代码风格、潜在 Bug、边界情况' },
          { id: 's2', order: 2, type: 'output', name: '提交 PR', description: '创建 Pull Request', prompt: '创建 PR，附上清晰的描述和测试截图' },
          { id: 's3', order: 3, type: 'approve', name: '等待审查', description: '等待团队审查反馈', prompt: '记录审查意见' },
          { id: 's4', order: 4, type: 'process', name: '修复问题', description: '根据审查意见修复', prompt: '处理审查中发现的问题' },
          { id: 's5', order: 5, type: 'approve', name: '合并确认', description: '最终确认后合并', prompt: '确认所有问题已修复，可以合并' }
        ]
      }
    ];

    for (const sop of defaultSOPs) {
      this.createSOP(sop as Omit<SOP, 'id' | 'createdAt' | 'updatedAt' | 'usageCount'>);
    }
  }

  // ============== SOP CRUD ==============

  createSOP(data: Omit<SOP, 'id' | 'createdAt' | 'updatedAt' | 'usageCount'>): SOP {
    const sop: SOP = {
      ...data,
      id: `sop_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      usageCount: 0
    };

    this.db.run(`
      INSERT INTO sops (id, name, description, trigger, steps, tags, created_at, updated_at, enabled, usage_count, avg_completion_time)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      sop.id,
      sop.name,
      sop.description,
      JSON.stringify(sop.trigger),
      JSON.stringify(sop.steps),
      JSON.stringify(sop.tags),
      sop.createdAt,
      sop.updatedAt,
      sop.enabled ? 1 : 0,
      0,
      null
    ]);

    return sop;
  }

  getSOP(id: string): SOP | null {
    const row = this.db.get('SELECT * FROM sops WHERE id = ?', [id]);
    return row ? this.rowToSOP(row) : null;
  }

  getAllSOPs(): SOP[] {
    const rows = this.db.all('SELECT * FROM sops ORDER BY usage_count DESC');
    return rows.map(r => this.rowToSOP(r));
  }

  getEnabledSOPs(): SOP[] {
    const rows = this.db.all('SELECT * FROM sops WHERE enabled = 1');
    return rows.map(r => this.rowToSOP(r));
  }

  updateSOP(id: string, updates: Partial<SOP>): SOP | null {
    const sop = this.getSOP(id);
    if (!sop) return null;

    const updated = { ...sop, ...updates, updatedAt: Date.now() };

    this.db.run(`
      UPDATE sops SET name=?, description=?, trigger=?, steps=?, tags=?, updated_at=?, enabled=?, avg_completion_time=?
      WHERE id=?
    `, [
      updated.name,
      updated.description,
      JSON.stringify(updated.trigger),
      JSON.stringify(updated.steps),
      JSON.stringify(updated.tags),
      updated.updatedAt,
      updated.enabled ? 1 : 0,
      updated.avgCompletionTime || null,
      id
    ]);

    return updated;
  }

  deleteSOP(id: string): boolean {
    this.db.run('DELETE FROM sops WHERE id = ?', [id]);
    return true;
  }

  private rowToSOP(row: any): SOP {
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      trigger: JSON.parse(row.trigger),
      steps: JSON.parse(row.steps),
      tags: JSON.parse(row.tags || '[]'),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      enabled: row.enabled === 1,
      usageCount: row.usage_count,
      avgCompletionTime: row.avg_completion_time
    };
  }

  // ============== SOP 匹配 ==============

  /**
   * 根据任务/会话特征匹配适合的 SOP
   */
  matchSOP(context: {
    tags?: string[];
    priority?: string;
    title?: string;
    description?: string;
    type?: string;
  }): SOP | null {
    const sops = this.getEnabledSOPs();
    let bestMatch: SOP | null = null;
    let bestScore = 0;

    for (const sop of sops) {
      let score = 0;
      const { trigger } = sop;

      switch (trigger.type) {
        case 'tag':
          if (context.tags?.some(t => sop.tags.includes(t))) {
            score += 10;
          }
          break;
        case 'keyword':
          if (trigger.value && context.title?.includes(trigger.value)) {
            score += 8;
          }
          break;
        case 'priority':
          if (context.priority === trigger.priority) {
            score += 10;
          }
          break;
        case 'all':
          score += 1;
          break;
      }

      // 标签重叠越多得分越高
      if (context.tags && sop.tags.length > 0) {
        const overlap = context.tags.filter(t => sop.tags.includes(t)).length;
        score += overlap * 2;
      }

      if (score > bestScore) {
        bestScore = score;
        bestMatch = sop;
      }
    }

    return bestScore > 0 ? bestMatch : null;
  }

  // ============== SOP 执行 ==============

  startExecution(sopId: string, context: { taskId?: string; sessionId?: string }): SOPExecution | null {
    const sop = this.getSOP(sopId);
    if (!sop) return null;

    const execution: SOPExecution = {
      id: `exec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      sopId,
      sopName: sop.name,
      taskId: context.taskId,
      sessionId: context.sessionId,
      status: 'running',
      currentStepIndex: 0,
      stepResults: [],
      startedAt: Date.now()
    };

    this.saveExecution(execution);

    // 更新使用计数
    this.db.run('UPDATE sops SET usage_count = usage_count + 1 WHERE id = ?', [sopId]);

    return execution;
  }

  getExecution(id: string): SOPExecution | null {
    const row = this.db.get('SELECT * FROM sop_executions WHERE id = ?', [id]);
    return row ? this.rowToExecution(row) : null;
  }

  getRunningExecutions(): SOPExecution[] {
    const rows = this.db.all("SELECT * FROM sop_executions WHERE status = 'running' ORDER BY started_at DESC");
    return rows.map(r => this.rowToExecution(r));
  }

  updateStepResult(executionId: string, stepResult: SOPStepResult): boolean {
    const execution = this.getExecution(executionId);
    if (!execution) return false;

    // 找到或创建步骤结果
    const existingIndex = execution.stepResults.findIndex(r => r.stepId === stepResult.stepId);
    if (existingIndex >= 0) {
      execution.stepResults[existingIndex] = stepResult;
    } else {
      execution.stepResults.push(stepResult);
    }

    this.saveExecution(execution);
    return true;
  }

  advanceStep(executionId: string): boolean {
    const execution = this.getExecution(executionId);
    if (!execution) return false;

    const sop = this.getSOP(execution.sopId);
    if (!sop) return false;

    execution.currentStepIndex++;
    if (execution.currentStepIndex >= sop.steps.length) {
      execution.status = 'completed';
      execution.completedAt = Date.now();
      execution.totalDuration = execution.completedAt - execution.startedAt;

      // 更新平均完成时间
      if (execution.totalDuration) {
        const avgMs = execution.totalDuration;
        const currentAvg = sop.avgCompletionTime || avgMs;
        sop.avgCompletionTime = currentAvg * 0.7 + avgMs * 0.3; // 移动平均
        this.updateSOP(sop.id, { avgCompletionTime: sop.avgCompletionTime });
      }
    }

    this.saveExecution(execution);
    return true;
  }

  cancelExecution(executionId: string): boolean {
    const execution = this.getExecution(executionId);
    if (!execution) return false;

    execution.status = 'cancelled';
    execution.completedAt = Date.now();
    execution.totalDuration = execution.completedAt - execution.startedAt;

    this.saveExecution(execution);
    return true;
  }

  private saveExecution(execution: SOPExecution): void {
    this.db.run(`
      INSERT OR REPLACE INTO sop_executions (id, sop_id, sop_name, task_id, session_id, status, current_step_index, step_results, started_at, completed_at, total_duration)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      execution.id,
      execution.sopId,
      execution.sopName,
      execution.taskId || null,
      execution.sessionId || null,
      execution.status,
      execution.currentStepIndex,
      JSON.stringify(execution.stepResults),
      execution.startedAt,
      execution.completedAt || null,
      execution.totalDuration || null
    ]);
  }

  private rowToExecution(row: any): SOPExecution {
    return {
      id: row.id,
      sopId: row.sop_id,
      sopName: row.sop_name,
      taskId: row.task_id || undefined,
      sessionId: row.session_id || undefined,
      status: row.status,
      currentStepIndex: row.current_step_index,
      stepResults: JSON.parse(row.step_results || '[]'),
      startedAt: row.started_at,
      completedAt: row.completed_at || undefined,
      totalDuration: row.total_duration || undefined
    };
  }

  // ============== SOP 模板导入/导出 ==============

  exportSOP(id: string): string | null {
    const sop = this.getSOP(id);
    return sop ? JSON.stringify(sop, null, 2) : null;
  }

  importSOP(json: string): SOP | null {
    try {
      const data = JSON.parse(json);
      return this.createSOP(data);
    } catch {
      return null;
    }
  }
}
