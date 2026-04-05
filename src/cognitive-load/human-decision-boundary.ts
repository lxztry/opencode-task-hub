/**
 * Cognitive Load Module - Human Decision Boundary
 * Phase 4: 人类决策边界明确化
 * 
 * 核心功能：明确哪些操作必须人类决策，哪些可以 AI 自动执行
 * 理论基础：人类专注高价值决策，低价值执行交给 AI
 */

import { Database } from '../database.js';

export type OperationCategory = 
  | 'code_commit'      // 代码提交
  | 'file_delete'      // 文件删除
  | 'multi_session'    // 跨 Session 协调
  | 'external_api'     // 外部 API 调用
  | 'data_write'       // 数据写入
  | 'security'         // 安全相关
  | 'financial'        // 财务相关
  | 'user_data'        // 用户数据操作
  | 'permission'       // 权限变更
  | 'deployment';      // 部署操作

export interface DecisionRule {
  id: string;
  category: OperationCategory;
  name: string;
  description: string;
  /** 匹配模式（正则表达式） */
  pattern?: string;
  /** 匹配关键词 */
  keywords?: string[];
  /** 必须人工确认 */
  requiresConfirmation: boolean;
  /** 是否启用 */
  enabled: boolean;
  priority: 'critical' | 'high' | 'medium' | 'low';
  /** 风险等级 */
  riskLevel: 'high' | 'medium' | 'low';
  createdAt: number;
  updatedAt: number;
}

export interface OperationContext {
  type: string;
  target: string;
  details: string;
  sessionId?: string;
  taskId?: string;
  agentType?: string;
  metadata?: Record<string, any>;
}

export interface DecisionResult {
  requiresHumanDecision: boolean;
  confidence: number;
  matchedRule?: DecisionRule;
  reason: string;
  suggestion?: string;
}

export class HumanDecisionBoundary {
  private db: Database;

  constructor(db: Database) {
    this.db = db;
    this.ensureTable();
    this.ensureDefaultRules();
  }

  private ensureTable(): void {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS decision_rules (
        id TEXT PRIMARY KEY,
        category TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        pattern TEXT,
        keywords TEXT,
        requires_confirmation INTEGER NOT NULL DEFAULT 1,
        enabled INTEGER NOT NULL DEFAULT 1,
        priority TEXT NOT NULL DEFAULT 'medium',
        risk_level TEXT NOT NULL DEFAULT 'medium',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS decision_logs (
        id TEXT PRIMARY KEY,
        rule_id TEXT,
        operation_type TEXT NOT NULL,
        operation_details TEXT,
        decision_result TEXT NOT NULL,
        session_id TEXT,
        task_id TEXT,
        created_at INTEGER NOT NULL,
        confirmed_at INTEGER,
        confirmed_by TEXT,
        notes TEXT
      )
    `);
  }

  private ensureDefaultRules(): void {
    const existing = this.db.all('SELECT COUNT(*) as count FROM decision_rules');
    if (existing[0]?.count > 0) return;

    const defaultRules: Omit<DecisionRule, 'id' | 'createdAt' | 'updatedAt'>[] = [
      // 高风险必须确认
      {
        category: 'code_commit',
        name: '代码合并到主分支',
        description: '任何向 main/master 分支的合并或提交',
        pattern: '(main|master|release).*commit|merge.*(main|master)',
        requiresConfirmation: true,
        enabled: true,
        priority: 'critical',
        riskLevel: 'high'
      },
      {
        category: 'file_delete',
        name: '删除系统文件',
        description: '删除关键系统文件或配置文件',
        keywords: ['rm -rf', 'rmdir', 'delete.*config', 'delete.*system'],
        requiresConfirmation: true,
        enabled: true,
        priority: 'critical',
        riskLevel: 'high'
      },
      {
        category: 'external_api',
        name: '调用外部支付 API',
        description: '涉及金钱交易的外部 API 调用',
        keywords: ['payment', 'stripe', 'paypal', 'billing', 'invoice'],
        requiresConfirmation: true,
        enabled: true,
        priority: 'critical',
        riskLevel: 'high'
      },
      {
        category: 'permission',
        name: '修改用户权限',
        description: '变更用户角色或访问权限',
        keywords: ['role', 'permission', 'access.*control', 'admin.*user'],
        requiresConfirmation: true,
        enabled: true,
        priority: 'high',
        riskLevel: 'high'
      },
      // 中风险建议确认
      {
        category: 'multi_session',
        name: '跨 Session 协调',
        description: '涉及多个 Session 的协调操作',
        keywords: ['coordinate', 'multi.*session', 'cross.*session'],
        requiresConfirmation: true,
        enabled: true,
        priority: 'medium',
        riskLevel: 'medium'
      },
      {
        category: 'deployment',
        name: '生产环境部署',
        description: '部署到生产环境',
        keywords: ['deploy.*production', 'deploy.*prod', 'release.*build'],
        requiresConfirmation: true,
        enabled: true,
        priority: 'high',
        riskLevel: 'high'
      },
      // 低风险可自动执行
      {
        category: 'data_write',
        name: '普通数据写入',
        description: '普通任务状态更新、评论等',
        keywords: ['update.*status', 'add.*comment', 'set.*field'],
        requiresConfirmation: false,
        enabled: true,
        priority: 'low',
        riskLevel: 'low'
      },
      {
        category: 'code_commit',
        name: '开发分支提交',
        description: '向非主分支的普通提交',
        keywords: ['commit.*dev', 'commit.*feature', 'commit.*fix'],
        requiresConfirmation: false,
        enabled: true,
        priority: 'low',
        riskLevel: 'low'
      }
    ];

    for (const rule of defaultRules) {
      this.createRule(rule);
    }
  }

  // ============== 规则管理 ==============

  createRule(data: Omit<DecisionRule, 'id' | 'createdAt' | 'updatedAt'>): DecisionRule {
    const rule: DecisionRule = {
      ...data,
      id: `rule_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    this.db.run(`
      INSERT INTO decision_rules (id, category, name, description, pattern, keywords, requires_confirmation, enabled, priority, risk_level, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      rule.id,
      rule.category,
      rule.name,
      rule.description,
      rule.pattern || null,
      JSON.stringify(rule.keywords || []),
      rule.requiresConfirmation ? 1 : 0,
      rule.enabled ? 1 : 0,
      rule.priority,
      rule.riskLevel,
      rule.createdAt,
      rule.updatedAt
    ]);

    return rule;
  }

  getRule(id: string): DecisionRule | null {
    const row = this.db.get('SELECT * FROM decision_rules WHERE id = ?', [id]);
    return row ? this.rowToRule(row) : null;
  }

  getAllRules(): DecisionRule[] {
    const rows = this.db.all('SELECT * FROM decision_rules ORDER BY priority, risk_level DESC');
    return rows.map(r => this.rowToRule(r));
  }

  getEnabledRules(): DecisionRule[] {
    const rows = this.db.all('SELECT * FROM decision_rules WHERE enabled = 1 ORDER BY priority, risk_level DESC');
    return rows.map(r => this.rowToRule(r));
  }

  updateRule(id: string, updates: Partial<DecisionRule>): DecisionRule | null {
    const rule = this.getRule(id);
    if (!rule) return null;

    const updated = { ...rule, ...updates, updatedAt: Date.now() };

    this.db.run(`
      UPDATE decision_rules SET category=?, name=?, description=?, pattern=?, keywords=?, requires_confirmation=?, enabled=?, priority=?, risk_level=?, updated_at=?
      WHERE id=?
    `, [
      updated.category,
      updated.name,
      updated.description,
      updated.pattern || null,
      JSON.stringify(updated.keywords || []),
      updated.requiresConfirmation ? 1 : 0,
      updated.enabled ? 1 : 0,
      updated.priority,
      updated.riskLevel,
      updated.updatedAt,
      id
    ]);

    return updated;
  }

  deleteRule(id: string): boolean {
    this.db.run('DELETE FROM decision_rules WHERE id = ?', [id]);
    return true;
  }

  private rowToRule(row: any): DecisionRule {
    return {
      id: row.id,
      category: row.category,
      name: row.name,
      description: row.description,
      pattern: row.pattern || undefined,
      keywords: JSON.parse(row.keywords || '[]'),
      requiresConfirmation: row.requires_confirmation === 1,
      enabled: row.enabled === 1,
      priority: row.priority,
      riskLevel: row.risk_level,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  // ============== 决策判断 ==============

  /**
   * 判断操作是否需要人类决策
   */
  evaluate(context: OperationContext): DecisionResult {
    const rules = this.getEnabledRules();
    
    // 按优先级排序，先检查高优先级规则
    const priorityOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
    rules.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

    let matchedRule: DecisionRule | undefined;
    let matched = false;

    for (const rule of rules) {
      if (this.matchesRule(context, rule)) {
        matchedRule = rule;
        matched = true;

        // 找到匹配的高优先级规则就停止
        if (rule.priority === 'critical' || rule.priority === 'high') {
          break;
        }
      }
    }

    if (!matched) {
      return {
        requiresHumanDecision: false,
        confidence: 0.9,
        reason: '操作未匹配任何特殊规则，按默认策略处理'
      };
    }

    const rule = matchedRule!;

    // 计算置信度
    let confidence = 0.8;
    if (rule.keywords && rule.keywords.length > 0) {
      confidence += 0.1;
    }
    if (rule.pattern) {
      confidence += 0.1;
    }

    // 生成建议
    let suggestion: string | undefined;
    if (rule.requiresConfirmation) {
      suggestion = `建议由人类确认此操作。风险等级: ${rule.riskLevel}`;
    }

    return {
      requiresHumanDecision: rule.requiresConfirmation,
      confidence: Math.min(0.99, confidence),
      matchedRule: rule,
      reason: `匹配规则: "${rule.name}" (${rule.category})`,
      suggestion
    };
  }

  /**
   * 检查上下文是否匹配规则
   */
  private matchesRule(context: OperationContext, rule: DecisionRule): boolean {
    const text = `${context.type} ${context.target} ${context.details}`.toLowerCase();

    // 检查关键词
    if (rule.keywords && rule.keywords.length > 0) {
      const hasKeyword = rule.keywords.some(kw => text.includes(kw.toLowerCase()));
      if (hasKeyword) return true;
    }

    // 检查正则模式
    if (rule.pattern) {
      try {
        const regex = new RegExp(rule.pattern, 'i');
        if (regex.test(text)) return true;
      } catch {
        // 正则无效，跳过
      }
    }

    // 检查类型匹配
    if (rule.category === context.type) {
      return true;
    }

    return false;
  }

  // ============== 决策日志 ==============

  /**
   * 记录决策结果
   */
  logDecision(
    context: OperationContext,
    result: DecisionResult,
    sessionId?: string,
    taskId?: string
  ): void {
    const id = `log_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    this.db.run(`
      INSERT INTO decision_logs (id, rule_id, operation_type, operation_details, decision_result, session_id, task_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      id,
      result.matchedRule?.id || null,
      context.type,
      JSON.stringify({ target: context.target, details: context.details }),
      JSON.stringify({ requiresHumanDecision: result.requiresHumanDecision, confidence: result.confidence }),
      sessionId || null,
      taskId || null,
      Date.now()
    ]);
  }

  /**
   * 确认决策（人工审批）
   */
  confirmDecision(logId: string, confirmedBy: string, notes?: string): boolean {
    this.db.run(`
      UPDATE decision_logs SET confirmed_at=?, confirmed_by=?, notes=?
      WHERE id=?
    `, [Date.now(), confirmedBy, notes || null, logId]);
    return true;
  }

  /**
   * 获取决策日志
   */
  getDecisionLogs(limit = 50): any[] {
    return this.db.all(`
      SELECT * FROM decision_logs 
      ORDER BY created_at DESC 
      LIMIT ?
    `, [limit]);
  }

  /**
   * 获取待确认的决策
   */
  getPendingDecisions(): any[] {
    return this.db.all(`
      SELECT * FROM decision_logs 
      WHERE confirmed_at IS NULL AND decision_result LIKE '%true%'
      ORDER BY created_at DESC
    `);
  }

  // ============== 便捷方法 ==============

  /**
   * 快速检查（用于集成到工作流）
   */
  quickCheck(operationType: string, details: string): DecisionResult {
    return this.evaluate({
      type: operationType,
      target: '',
      details
    });
  }

  /**
   * 获取所有必须确认的规则
   */
  getConfirmationRequiredRules(): DecisionRule[] {
    return this.getEnabledRules().filter(r => r.requiresConfirmation);
  }

  /**
   * 按类别获取规则
   */
  getRulesByCategory(category: OperationCategory): DecisionRule[] {
    return this.getEnabledRules().filter(r => r.category === category);
  }
}
