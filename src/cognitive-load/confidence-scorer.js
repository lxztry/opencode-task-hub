/**
 * Cognitive Load Module - Confidence Scorer
 * Phase 3: 置信度指标 - 消除焦虑负荷
 * 
 * 核心功能：为每个AI输出计算置信度，决定是否自动执行
 * 理论基础：AI幻觉、错误、逻辑偏差是焦虑的主要来源
 * 解决方案：让用户知道什么时候该信AI，什么时候该介入
 * 
 * 置信度等级：
 * - 🟢 95%+：高置信，AI自动执行
 * - 🟡 70-95%：中置信，通知用户
 * - 🔴 <70%：低置信，暂停等待人工确认
 */

import { Session, Task } from '../types.js';

export type ConfidenceLevel = 'high' | 'medium' | 'low';
export type ActionRequired = 'auto' | 'notify' | 'confirm';

export interface ConfidenceResult {
  /** 置信度 0-1 */
  score: number;
  /** 置信等级 */
  level: ConfidenceLevel;
  /** 建议动作 */
  action: ActionRequired;
  /** 打分因素 */
  factors: ConfidenceFactor[];
  /** 简要说明 */
  summary: string;
}

export interface ConfidenceFactor {
  name: string;
  impact: 'positive' | 'negative' | 'neutral';
  weight: number;
  detail: string;
}

export interface ChangeRecord {
  id: string;
  timestamp: number;
  actionType: 'create' | 'update' | 'delete' | 'execute';
  targetType: 'task' | 'session' | 'file' | 'code' | 'artifact';
  targetId: string;
  targetName: string;
  beforeState?: any;
  afterState?: any;
  confidence: number;
  userConfirmation?: 'confirmed' | 'rejected' | 'pending';
  notes?: string;
}

export class ConfidenceScorer {
  private changeHistory: ChangeRecord[] = [];
  private historicalAccuracy: number = 0.85; // 初始值，可根据实际数据调整
  private db: Database;

  constructor(db: Database) {
    this.db = db;
    this.ensureTable();
    this.loadHistoricalData();
  }

  private ensureTable(): void {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS confidence_history (
        id TEXT PRIMARY KEY,
        change_data TEXT NOT NULL,
        historical_accuracy REAL NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);
  }

  // ============== 核心评分方法 ==============

  /**
   * 评估AI输出的整体置信度
   */
  evaluateConfidence(
    context: {
      session?: Session;
      task?: Task;
      outputType: 'summary' | 'suggestion' | 'code' | 'decision' | 'task-creation';
      outputContent?: string;
    }
  ): ConfidenceResult {
    const factors: ConfidenceFactor[] = [];

    // 1. 历史准确率因素
    factors.push({
      name: '历史准确率',
      impact: this.historicalAccuracy >= 0.8 ? 'positive' : 'negative',
      weight: 0.15,
      detail: `基于${this.changeHistory.length}次操作历史，准确率${(this.historicalAccuracy * 100).toFixed(0)}%`
    });

    // 2. 上下文完整性因素
    const contextScore = this.evaluateContextCompleteness(context);
    factors.push({
      name: '上下文完整性',
      impact: contextScore >= 0.7 ? 'positive' : 'negative',
      weight: 0.2,
      detail: `上下文评分: ${(contextScore * 100).toFixed(0)}%`
    });

    // 3. 任务复杂度因素
    const complexityPenalty = this.evaluateComplexity(context);
    factors.push({
      name: '任务复杂度',
      impact: complexityPenalty > 0.3 ? 'negative' : 'positive',
      weight: 0.15,
      detail: `复杂度影响: ${complexityPenalty > 0 ? '+' : ''}${(complexityPenalty * 100).toFixed(0)}%`
    });

    // 4. 敏感性因素（是否涉及敏感操作）
    const sensitivityPenalty = this.evaluateSensitivity(context);
    factors.push({
      name: '操作敏感性',
      impact: sensitivityPenalty > 0 ? 'negative' : 'positive',
      weight: 0.2,
      detail: sensitivityPenalty > 0 ? '涉及敏感操作，需要确认' : '普通操作，无敏感风险'
    });

    // 5. 内容质量因素
    const contentScore = this.evaluateContentQuality(context.outputContent);
    factors.push({
      name: '输出内容质量',
      impact: contentScore >= 0.7 ? 'positive' : 'negative',
      weight: 0.15,
      detail: `内容评分: ${(contentScore * 100).toFixed(0)}%`
    });

    // 6. 不确定性信号
    const uncertaintySignals = this.detectUncertainty(context.outputContent);
    factors.push({
      name: '不确定性信号',
      impact: uncertaintySignals > 0 ? 'negative' : 'positive',
      weight: 0.15,
      detail: uncertaintySignals > 0 ? `检测到${uncertaintySignals}个不确定表达` : '无明显不确定信号'
    });

    // 计算总分
    let totalScore = this.historicalAccuracy * 0.15;
    totalScore += contextScore * 0.2;
    totalScore += (1 - complexityPenalty) * 0.15;
    totalScore += (1 - sensitivityPenalty) * 0.2;
    totalScore += contentScore * 0.15;
    totalScore += (1 - uncertaintySignals * 0.1) * 0.15;

    // 确定置信等级和建议动作
    let level: ConfidenceLevel;
    let action: ActionRequired;

    if (totalScore >= 0.95) {
      level = 'high';
      action = 'auto';
    } else if (totalScore >= 0.70) {
      level = 'medium';
      action = 'notify';
    } else {
      level = 'low';
      action = 'confirm';
    }

    // 生成总结
    const summary = this.generateSummary(level, context);

    return {
      score: Math.min(0.99, Math.max(0.10, totalScore)),
      level,
      action,
      factors,
      summary
    };
  }

  /**
   * 评估上下文完整性
   */
  private evaluateContextCompleteness(context: any): number {
    let score = 0.5;

    if (context.session) {
      score += 0.15;
      if (context.session.context.files.length > 0) score += 0.05;
      if (context.session.context.tasks.length > 0) score += 0.05;
      if (context.session.context.summary) score += 0.1;
      if (context.session.checkpoints.length > 0) score += 0.05;
    }

    if (context.task) {
      score += 0.1;
      if (context.task.description && context.task.description.length > 50) score += 0.05;
      if (context.task.dependencies && context.task.dependencies.length > 0) score += 0.05;
    }

    return Math.min(1.0, score);
  }

  /**
   * 评估任务复杂度（返回惩罚值）
   */
  private evaluateComplexity(context: any): number {
    let penalty = 0;

    if (context.session) {
      // 文件多 → 复杂度高
      if (context.session.context.files.length > 10) penalty += 0.2;
      else if (context.session.context.files.length > 5) penalty += 0.1;

      // 子会话多 → 复杂度高
      if (context.session.childIds.length > 5) penalty += 0.2;
      else if (context.session.childIds.length > 2) penalty += 0.1;

      // 快照多 → 可能混乱
      if (context.session.checkpoints.length > 10) penalty += 0.1;
    }

    if (context.task) {
      // 子任务多 → 复杂度高
      if (context.task.subtasks && context.task.subtasks.length > 5) penalty += 0.15;
      
      // 依赖多 → 复杂度高
      if (context.task.dependencies && context.task.dependencies.length > 3) penalty += 0.15;
    }

    // 代码生成比摘要复杂度高
    if (context.outputType === 'code') penalty += 0.1;

    return Math.min(0.5, penalty);
  }

  /**
   * 评估操作敏感性（返回惩罚值）
   */
  private evaluateSensitivity(context: any): number {
    let penalty = 0;

    // 涉及删除操作 → 高敏感
    if (context.outputType === 'delete') penalty += 0.4;

    // 涉及代码执行 → 高敏感
    if (context.outputType === 'execute') penalty += 0.5;

    // 涉及外部API → 中敏感
    if (context.outputContent && (
      context.outputContent.includes('fetch(') ||
      context.outputContent.includes('http') ||
      context.outputContent.includes('curl')
    )) {
      penalty += 0.2;
    }

    // 涉及数据库写入 → 中敏感
    if (context.outputType === 'create' || context.outputType === 'update') {
      penalty += 0.15;
    }

    // 涉及敏感关键词 → 额外敏感
    const sensitivePatterns = [
      'password', 'secret', 'token', 'api_key', 'private_key',
      'rm -rf', 'delete', 'drop', 'truncate'
    ];
    
    if (context.outputContent) {
      for (const pattern of sensitivePatterns) {
        if (context.outputContent.toLowerCase().includes(pattern)) {
          penalty += 0.15;
          break;
        }
      }
    }

    return Math.min(0.6, penalty);
  }

  /**
   * 评估内容质量
   */
  private evaluateContentQuality(content?: string): number {
    if (!content) return 0.5;

    let score = 0.5;

    // 长度合理性
    if (content.length > 20 && content.length < 5000) score += 0.2;
    else if (content.length >= 5000) score += 0.1; // 长内容可能有更多细节
    else if (content.length < 20) score -= 0.2; // 太短可能不完整

    // 结构化程度
    if (content.includes('\n')) score += 0.1; // 有换行说明有结构
    if (content.includes('{') && content.includes('}')) score += 0.1; // 可能是代码
    if (/^\s*[-*]\s/m.test(content)) score += 0.05; // 列表格式

    // 错误标记
    const errorPatterns = ['undefined', 'null', 'NaN', 'Error:', 'Exception:'];
    for (const pattern of errorPatterns) {
      if (content.includes(pattern)) {
        score -= 0.15;
        break;
      }
    }

    return Math.min(1.0, Math.max(0.1, score));
  }

  /**
   * 检测不确定性信号
   */
  private detectUncertainty(content?: string): number {
    if (!content) return 0;

    const uncertaintySignals = [
      '可能', '也许', '不确定', '大概', 'perhaps', 'maybe', 'probably',
      '不确定', '不清楚', '不知道', 'maybe', 'might', 'could be',
      '建议人工', '最好确认', '请核实', '建议检查',
      'I\'m not sure', 'I don\'t know', 'unclear'
    ];

    let count = 0;
    const lowerContent = content.toLowerCase();
    
    for (const signal of uncertaintySignals) {
      if (lowerContent.includes(signal.toLowerCase())) {
        count++;
      }
    }

    return Math.min(3, count); // 最多算3个
  }

  /**
   * 生成总结文字
   */
  private generateSummary(level: ConfidenceLevel, context: any): string {
    const action = context.outputType || '操作';

    switch (level) {
      case 'high':
        return `AI对这次${action}很有信心，建议自动执行`;
      case 'medium':
        return `AI对这次${action}有一定把握，已通知您确认`;
      case 'low':
        return `AI对这次${action}信心不足，需要您明确确认`;
    }
  }

  // ============== 变更记录 ==============

  /**
   * 记录一次变更操作
   */
  recordChange(change: Omit<ChangeRecord, 'id' | 'timestamp'>): ChangeRecord {
    const record: ChangeRecord = {
      ...change,
      id: `change_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: Date.now()
    };

    this.changeHistory.push(record);

    // 保留最近100条记录
    if (this.changeHistory.length > 100) {
      this.changeHistory = this.changeHistory.slice(-100);
    }

    // 更新历史准确率（基于确认结果）
    if (change.userConfirmation === 'confirmed') {
      this.historicalAccuracy = this.historicalAccuracy * 0.9 + 0.1 * 1.0;
    } else if (change.userConfirmation === 'rejected') {
      this.historicalAccuracy = this.historicalAccuracy * 0.9 + 0.1 * 0.0;
    }

    this.saveHistoricalData();
    return record;
  }

  /**
   * 确认或拒绝一次变更
   */
  confirmChange(changeId: string, confirmed: boolean, notes?: string): boolean {
    const change = this.changeHistory.find(c => c.id === changeId);
    if (!change) return false;

    change.userConfirmation = confirmed ? 'confirmed' : 'rejected';
    if (notes) change.notes = notes;

    // 更新准确率
    this.historicalAccuracy = this.historicalAccuracy * 0.9 + 0.1 * (confirmed ? 1.0 : 0.0);
    this.saveHistoricalData();

    return true;
  }

  /**
   * 获取变更历史
   */
  getChangeHistory(limit = 20): ChangeRecord[] {
    return this.changeHistory.slice(-limit).reverse();
  }

  /**
   * 获取待确认的变更
   */
  getPendingChanges(): ChangeRecord[] {
    return this.changeHistory.filter(c => c.userConfirmation === 'pending');
  }

  // ============== 持久化 ==============

  private loadHistoricalData(): void {
    try {
      const row = this.db.get('SELECT * FROM confidence_history ORDER BY updated_at DESC LIMIT 1');
      if (row) {
        this.changeHistory = JSON.parse(row.change_data || '[]');
        this.historicalAccuracy = row.historical_accuracy || 0.85;
      }
    } catch (e) {
      // 忽略错误，使用默认值
    }
  }

  private saveHistoricalData(): void {
    try {
      this.db.run(`
        INSERT OR REPLACE INTO confidence_history (id, change_data, historical_accuracy, updated_at)
        VALUES ('main', ?, ?, ?)
      `, [JSON.stringify(this.changeHistory), this.historicalAccuracy, Date.now()]);
    } catch (e) {
      // 忽略错误
    }
  }

  // ============== 便捷方法 ==============

  /**
   * 快速检查是否需要人工确认
   */
  needsConfirmation(context: {
    outputType: string;
    outputContent?: string;
  }): boolean {
    const result = this.evaluateConfidence(context);
    return result.action === 'confirm';
  }

  /**
   * 获取置信度颜色代码
   */
  getConfidenceColor(score: number): string {
    if (score >= 0.95) return '#22c55e'; // 绿色
    if (score >= 0.70) return '#eab308'; // 黄色
    return '#ef4444'; // 红色
  }

  /**
   * 获取置信度文字标签
   */
  getConfidenceLabel(score: number): string {
    if (score >= 0.95) return '高置信';
    if (score >= 0.70) return '中置信';
    return '低置信';
  }
}
