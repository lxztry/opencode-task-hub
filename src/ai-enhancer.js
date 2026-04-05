/**
 * OpenCode Task Hub - AI Enhancer
 * LLM-powered task analysis, summarization, and suggestions
 */

import { Task, Session, TeamMember } from './types.js';

interface AISuggestion {
  type: 'assignment' | 'estimation' | 'summary' | 'risk' | 'optimization';
  confidence: number;
  message: string;
  data?: any;
}

interface TaskAnalysis {
  complexity: 'low' | 'medium' | 'high' | 'very-high';
  suggestedEstimate: number;  // hours
  potentialRisks: string[];
  skillRequirements: string[];
  similarTasks?: string[];
}

interface SprintForecast {
  estimatedCompletion: Date;
  confidence: number;
  risks: string[];
  suggestions: string[];
}

export class AIEnhancer {
  private apiKey?: string;
  private baseUrl: string;

  constructor(apiKey?: string) {
    this.apiKey = apiKey;
    this.baseUrl = process.env.LLM_BASE_URL || 'https://open.bigmodel.cn/api/paas/v4';
  }

  // ============== Task Analysis ==============

  async analyzeTask(task: Task): Promise<TaskAnalysis> {
    // 基于任务特征分析复杂度
    let complexity: TaskAnalysis['complexity'] = 'low';
    let estimate = 2; // 基础工时

    // 分析复杂度因素
    const factors = {
      hasDescription: task.description.length > 100,
      hasSubtasks: (task.subtasks?.length || 0) > 3,
      hasDependencies: (task.dependencies?.length || 0) > 0,
      isHighPriority: task.priority === 'high' || task.priority === 'critical',
      hasTags: (task.tags?.length || 0) > 2
    };

    // 计算复杂度
    let complexityScore = 0;
    if (factors.hasDescription) complexityScore += 1;
    if (factors.hasSubtasks) complexityScore += 2;
    if (factors.hasDependencies) complexityScore += 1;
    if (factors.isHighPriority) complexityScore += 1;
    if (factors.hasTags) complexityScore += 0.5;

    if (complexityScore >= 4) complexity = 'very-high';
    else if (complexityScore >= 3) complexity = 'high';
    else if (complexityScore >= 2) complexity = 'medium';

    // 估算工时
    const baseEstimates = { low: 2, medium: 4, high: 8, 'very-high': 16 };
    estimate = baseEstimates[complexity];

    // 根据优先级调整
    if (task.priority === 'critical') estimate *= 1.5;
    if (task.priority === 'high') estimate *= 1.2;

    // 根据描述长度调整
    if (task.description.length > 500) estimate *= 1.3;

    // 识别潜在风险
    const risks: string[] = [];
    if (task.dependencies && task.dependencies.length > 2) {
      risks.push('依赖任务较多，可能影响进度');
    }
    if (task.priority === 'critical' && !task.assignee) {
      risks.push('紧急任务未分配');
    }
    if (task.dueDate && task.dueDate < Date.now() + 86400000 * 2) {
      risks.push('截止日期临近');
    }

    // 技能需求
    const skillRequirements = [...task.tags];

    return {
      complexity,
      suggestedEstimate: Math.ceil(estimate),
      potentialRisks: risks,
      skillRequirements
    };
  }

  // ============== Smart Assignment ==============

  async suggestAssignee(task: Task, team: TeamMember[]): Promise<{
    assigneeId: string;
    assigneeName: string;
    confidence: number;
    reason: string;
    alternative?: { id: string; name: string; score: number };
  }> {
    // 评分算法
    const scores = team.map(member => {
      let score = 0;
      let reasons: string[] = [];

      // 技能匹配度 (50%)
      const skillMatch = member.skills.filter(skill =>
        task.tags.some(tag => 
          tag.toLowerCase().includes(skill.toLowerCase()) ||
          skill.toLowerCase().includes(tag.toLowerCase())
        )
      ).length;
      
      if (skillMatch > 0) {
        score += skillMatch * 25;
        reasons.push(`${skillMatch}项技能匹配`);
      }

      // 可用性 (30%)
      const availabilityScore = member.availability / 100;
      score += availabilityScore * 30;
      reasons.push(`可用性${member.availability}%`);

      // 工作量 (20%) - 当前任务少优先
      const workloadScore = Math.max(0, 1 - member.currentTasks / 10);
      score += workloadScore * 20;

      return { member, score, reasons };
    });

    // 排序
    scores.sort((a, b) => b.score - a.score);

    const best = scores[0];
    const alternative = scores[1];

    return {
      assigneeId: best.member.id,
      assigneeName: best.member.name,
      confidence: Math.min(0.95, best.score / 100),
      reason: `推荐理由: ${best.reasons.join(', ')}`,
      alternative: alternative ? {
        id: alternative.member.id,
        name: alternative.member.name,
        score: alternative.score
      } : undefined
    };
  }

  // ============== Session Summary ==============

  async generateSessionSummary(session: Session): Promise<string> {
    const parts: string[] = [];

    // 基础信息
    parts.push(`会话 "${session.name}" 总结`);
    parts.push(`类型: ${session.type}`);
    parts.push(`状态: ${session.status}`);

    // 上下文信息
    if (session.context.files.length > 0) {
      parts.push(`涉及文件: ${session.context.files.length}个`);
    }

    if (session.context.tasks.length > 0) {
      parts.push(`关联任务: ${session.context.tasks.length}个`);
    }

    if (session.context.artifacts.length > 0) {
      parts.push(`产出物: ${session.context.artifacts.length}个`);
    }

    // 关键决策
    if (session.context.keyDecisions.length > 0) {
      parts.push('\n关键决策:');
      session.context.keyDecisions.forEach((d, i) => {
        parts.push(`  ${i + 1}. ${d}`);
      });
    }

    // 阻碍因素
    if (session.context.blockers.length > 0) {
      parts.push('\n当前阻碍:');
      session.context.blockers.forEach((b, i) => {
        parts.push(`  ${i + 1}. ${b}`);
      });
    }

    // 快照数量
    if (session.checkpoints.length > 0) {
      parts.push(`\n已创建 ${session.checkpoints.length} 个快照`);
    }

    return parts.join('\n');
  }

  // ============== Risk Detection ==============

  async detectRisks(tasks: Task[], sessions: Session[]): Promise<AISuggestion[]> {
    const risks: AISuggestion[] = [];

    // 检查未分配的高优先级任务
    const unassignedHighPriority = tasks.filter(
      t => (t.priority === 'high' || t.priority === 'critical') && !t.assignee
    );
    
    if (unassignedHighPriority.length > 0) {
      risks.push({
        type: 'risk',
        confidence: 0.9,
        message: `${unassignedHighPriority.length}个高优先级任务未分配`,
        data: { taskIds: unassignedHighPriority.map(t => t.id) }
      });
    }

    // 检查过期任务
    const overdueTasks = tasks.filter(
      t => t.dueDate && t.dueDate < Date.now() && t.status !== 'done'
    );

    if (overdueTasks.length > 0) {
      risks.push({
        type: 'risk',
        confidence: 0.95,
        message: `${overdueTasks.length}个任务已过期`,
        data: { taskIds: overdueTasks.map(t => t.id) }
      });
    }

    // 检查有阻碍的会话
    const blockedSessions = sessions.filter(s => s.context.blockers.length > 0);
    
    if (blockedSessions.length > 0) {
      risks.push({
        type: 'risk',
        confidence: 0.8,
        message: `${blockedSessions.length}个会话遇到阻碍需要关注`,
        data: { sessionIds: blockedSessions.map(s => s.id) }
      });
    }

    // 检查依赖死锁
    const taskMap = new Map(tasks.map(t => [t.id, t]));
    for (const task of tasks) {
      if (task.dependencies) {
        for (const depId of task.dependencies) {
          const dep = taskMap.get(depId);
          if (dep && dep.status === 'blocked') {
            risks.push({
              type: 'risk',
              confidence: 0.7,
              message: `任务 "${task.title}" 依赖的 "${dep.title}" 被阻塞`,
              data: { taskId: task.id, blockedDepId: depId }
            });
          }
        }
      }
    }

    return risks;
  }

  // ============== Sprint Forecast ==============

  async forecastSprint(
    tasks: Task[], 
    teamSize: number, 
    sprintDays: number
  ): Promise<SprintForecast> {
    const now = Date.now();
    const sprintEnd = now + sprintDays * 86400000;

    // 统计
    const totalTasks = tasks.length;
    const completedTasks = tasks.filter(t => t.status === 'done').length;
    const remainingTasks = tasks.filter(t => t.status !== 'done').length;

    // 估算剩余工作量
    let remainingHours = 0;
    for (const task of tasks.filter(t => t.status !== 'done')) {
      const analysis = await this.analyzeTask(task);
      remainingHours += analysis.suggestedEstimate;
    }

    // 团队产能估算 (每天每人8小时)
    const dailyCapacity = teamSize * 8;
    const totalCapacity = dailyCapacity * sprintDays;

    // 完成时间估算
    const daysNeeded = Math.ceil(remainingHours / dailyCapacity);
    const estimatedCompletion = new Date(now + daysNeeded * 86400000);

    // 置信度
    let confidence = 0.5;
    if (totalTasks > 5) confidence += 0.1;
    if (remainingHours < totalCapacity) confidence += 0.2;
    if (teamSize >= 3) confidence += 0.1;
    confidence = Math.min(0.95, confidence);

    // 风险
    const risks: string[] = [];
    if (estimatedCompletion > sprintEnd) {
      risks.push(`预计无法在sprint周期内完成 (需要${daysNeeded}天)`);
    }
    if (remainingHours > totalCapacity * 1.5) {
      risks.push('工作量超出团队产能50%以上');
    }

    // 建议
    const suggestions: string[] = [];
    if (remainingTasks > teamSize * 3) {
      suggestions.push('建议减少sprint范围');
    }
    if (estimatedCompletion > sprintEnd) {
      suggestions.push('考虑延长期限或增加资源');
    }

    return {
      estimatedCompletion,
      confidence,
      risks,
      suggestions
    };
  }

  // ============== Optimization Suggestions ==============

  async suggestOptimizations(tasks: Task[]): Promise<AISuggestion[]> {
    const suggestions: AISuggestion[] = [];

    // 任务粒度优化
    const largeTasks = tasks.filter(t => {
      return t.subtasks && t.subtasks.length < 3 && t.description.length > 300;
    });

    if (largeTasks.length > 0) {
      suggestions.push({
        type: 'optimization',
        confidence: 0.75,
        message: `${largeTasks.length}个任务描述过长，建议拆分为更小的子任务`,
        data: { taskIds: largeTasks.map(t => t.id) }
      });
    }

    // 批量任务建议
    const tagGroups = new Map<string, Task[]>();
    for (const task of tasks.filter(t => t.status === 'todo')) {
      for (const tag of task.tags) {
        if (!tagGroups.has(tag)) tagGroups.set(tag, []);
        tagGroups.get(tag)!.push(task);
      }
    }

    for (const [tag, groupTasks] of tagGroups) {
      if (groupTasks.length >= 3) {
        suggestions.push({
          type: 'optimization',
          confidence: 0.8,
          message: `发现${groupTasks.length}个"${tag}"相关任务可批量处理`,
          data: { tag, taskIds: groupTasks.map(t => t.id) }
        });
      }
    }

    // 优先级冲突
    const criticalWithLowDeps = tasks.filter(t => 
      t.priority === 'critical' && 
      (!t.dependencies || t.dependencies.length === 0)
    );

    if (criticalWithLowDeps.length > 0) {
      suggestions.push({
        type: 'optimization',
        confidence: 0.6,
        message: `${criticalWithLowDeps.length}个紧急任务缺少依赖关系定义`,
        data: { taskIds: criticalWithLowDeps.map(t => t.id) }
      });
    }

    return suggestions;
  }

  // ============== Natural Language Task Creation ==============

  async parseNaturalLanguage(text: string): Promise<Partial<Task>> {
    // 简单的规则解析
    const result: Partial<Task> = {
      title: text,
      tags: [],
      priority: 'medium',
      status: 'todo'
    };

    // 提取优先级
    if (text.includes('紧急') || text.includes('urgent') || text.includes('ASAP')) {
      result.priority = 'critical';
      result.title = result.title.replace(/紧急|urgent|ASAP/gi, '').trim();
    } else if (text.includes('高优') || text.includes('important')) {
      result.priority = 'high';
      result.title = result.title.replace(/高优|important/gi, '').trim();
    } else if (text.includes('低优') || text.includes('low priority')) {
      result.priority = 'low';
      result.title = result.title.replace(/低优|low priority/gi, '').trim();
    }

    // 提取标签
    const tagPatterns = [/#\w+/g, /\[([^\]]+)\]/g];
    for (const pattern of tagPatterns) {
      const matches = text.match(pattern);
      if (matches) {
        result.tags = [...(result.tags || []), ...matches.map(m => m.replace(/[#\[\]]/g, ''))];
      }
    }

    // 提取截止日期
    const datePatterns = [
      /(\d{1,2})[\/\-](\d{1,2})/,  // MM/DD or MM-DD
      /(\d+)天/,                      // X天后
    ];

    for (const pattern of datePatterns) {
      const match = text.match(pattern);
      if (match) {
        if (match[1] && match[2]) {
          // 日期格式
          const month = parseInt(match[1]);
          const day = parseInt(match[2]);
          const year = new Date().getFullYear();
          result.dueDate = new Date(year, month - 1, day).getTime();
        } else if (match[1]) {
          // X天后
          result.dueDate = Date.now() + parseInt(match[1]) * 86400000;
        }
        break;
      }
    }

    // 清理标题
    result.title = result.title
      .replace(/[#\[\]]/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    return result;
  }
}
