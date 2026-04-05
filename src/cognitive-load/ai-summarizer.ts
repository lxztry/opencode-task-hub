/**
 * Cognitive Load Module - AI Context Summarizer
 * Phase 2: AI上下文摘要 - 突破上下文上限
 * 
 * 核心功能：把每个Session压缩成3句话摘要
 * 理论基础：7±2工作记忆法则，人类同时追踪的上下文有生理上限
 * 解决方案：AI自动生成摘要，让用户"看3句话"而不是"理解整个Session"
 */

import { Session } from '../types.js';

export interface SessionSummary {
  sessionId: string;
  /** 当前进度是什么？（一句话） */
  progress: string;
  /** 遇到什么阻碍？（一句话） */
  blocker: string;
  /** 下一步建议做什么？（一句话） */
  nextAction: string;
  /** 完整摘要（可选展示） */
  fullSummary?: string;
  /** 置信度 0-1 */
  confidence: number;
  /** 摘要生成时间 */
  generatedAt: number;
}

export interface TaskSummary {
  taskId: string;
  /** 任务当前状态的一句话描述 */
  status: string;
  /** 剩余工作量估算 */
  remainingWork: string;
  /** 下一步具体行动 */
  nextStep: string;
  confidence: number;
}

export class AISummarizer {
  private apiKey?: string;
  private baseUrl: string;

  constructor(apiKey?: string) {
    this.apiKey = apiKey;
    this.baseUrl = process.env.LLM_BASE_URL || 'https://open.bigmodel.cn/api/paas/v4';
  }

  // ============== Session 摘要生成 ==============

  /**
   * 为单个Session生成3句话摘要
   */
  async summarizeSession(session: Session): Promise<SessionSummary> {
    const { progress, blocker, nextAction, fullSummary } = this.analyzeSessionContext(session);

    return {
      sessionId: session.id,
      progress,
      blocker,
      nextAction,
      fullSummary,
      confidence: this.calculateSummaryConfidence(session),
      generatedAt: Date.now()
    };
  }

  /**
   * 批量生成Session摘要（带缓存）
   */
  async summarizeSessions(sessions: Session[], cache?: Map<string, SessionSummary>): Promise<SessionSummary[]> {
    const results: SessionSummary[] = [];
    const cacheMap = cache || new Map();

    for (const session of sessions) {
      // 检查缓存（5分钟内有效）
      const cached = cacheMap.get(session.id);
      if (cached && Date.now() - cached.generatedAt < 5 * 60 * 1000) {
        results.push(cached);
        continue;
      }

      // 生成新摘要
      const summary = await this.summarizeSession(session);
      results.push(summary);
      cacheMap.set(session.id, summary);
    }

    return results;
  }

  /**
   * 分析Session上下文，生成结构化摘要
   */
  private analyzeSessionContext(session: Session): {
    progress: string;
    blocker: string;
    nextAction: string;
    fullSummary: string;
  } {
    const parts: string[] = [];

    // 1. 分析进度
    let progress = this.extractProgress(session);
    
    // 2. 分析阻碍
    let blocker = this.extractBlocker(session);
    
    // 3. 生成下一步建议
    let nextAction = this.suggestNextAction(session);

    // 4. 生成完整摘要
    parts.push(`Session: ${session.name}`);
    parts.push(`Status: ${session.status} | Type: ${session.type}`);
    
    if (session.context.files.length > 0) {
      parts.push(`Files: ${session.context.files.length} files involved`);
    }
    if (session.context.tasks.length > 0) {
      parts.push(`Tasks: ${session.context.tasks.length} linked tasks`);
    }
    if (session.context.artifacts.length > 0) {
      parts.push(`Artifacts: ${session.context.artifacts.length} artifacts produced`);
    }
    
    parts.push(`\nProgress: ${progress}`);
    parts.push(`Blocker: ${blocker}`);
    parts.push(`Next Action: ${nextAction}`);

    return {
      progress,
      blocker,
      nextAction,
      fullSummary: parts.join('\n')
    };
  }

  /**
   * 从Session提取进度描述
   */
  private extractProgress(session: Session): string {
    const checkpoints = session.checkpoints.length;
    const files = session.context.files.length;
    const tasks = session.context.tasks.length;
    const artifacts = session.context.artifacts.length;
    const decisions = session.context.keyDecisions.length;

    // 基于Session状态和上下文判断进度
    switch (session.status) {
      case 'completed':
        return '已完成所有工作';
      case 'archived':
        return '已归档';
      case 'paused':
        return '暂停中';
      case 'active':
        if (checkpoints === 0 && files === 0 && tasks === 0) {
          return '刚启动，尚未开始实质性工作';
        }
        if (checkpoints >= 3) {
          return `进行中（已创建${checkpoints}个快照，${files}个文件，${artifacts}个产出物）`;
        }
        if (artifacts > 0) {
          return `有产出（${artifacts}个产出物，${files}个相关文件）`;
        }
        if (files > 0) {
          return `处理中（涉及${files}个文件，${tasks}个任务）`;
        }
        return '进行中（已做' + decisions + '个决策）';
      default:
        return '状态未知';
    }
  }

  /**
   * 从Session提取阻碍描述
   */
  private extractBlocker(session: Session): string {
    const blockers = session.context.blockers;
    
    if (blockers.length > 0) {
      return blockers[0]; // 只显示第一个阻碍
    }

    // 智能判断可能的阻碍
    if (session.status === 'paused') {
      return '会话已暂停，原因未知';
    }

    // 检查是否有可疑的停滞迹象
    const age = Date.now() - session.updatedAt;
    const dayInMs = 24 * 60 * 60 * 1000;
    
    if (age > 3 * dayInMs && session.status === 'active') {
      return '超过3天未更新，可能已停滞';
    }

    return '暂无明确阻碍';
  }

  /**
   * 建议下一步行动
   */
  private suggestNextAction(session: Session): string {
    const blockers = session.context.blockers;
    
    // 有阻碍先解决阻碍
    if (blockers.length > 0) {
      return `解决阻碍: ${blockers[0]}`;
    }

    // 基于Session状态建议
    switch (session.status) {
      case 'active':
        // 有文件修改建议查看
        if (session.context.files.length > 0) {
          const latestFile = session.context.files[session.context.files.length - 1];
          return `查看最新文件: ${latestFile}`;
        }
        // 有任务建议跟进
        if (session.context.tasks.length > 0) {
          return `推进关联任务（${session.context.tasks.length}个）`;
        }
        // 什么都没有建议创建快照
        if (session.checkpoints.length === 0) {
          return '创建第一个快照记录当前状态';
        }
        return '继续当前工作或创建新快照';
      case 'paused':
        return '恢复会话继续工作';
      case 'completed':
        return '会话已完成，无需操作';
      default:
        return '检查会话状态';
    }
  }

  /**
   * 计算摘要置信度
   */
  private calculateSummaryConfidence(session: Session): number {
    let score = 0.5; // 基础分

    // 上下文丰富度加成
    if (session.context.files.length > 0) score += 0.1;
    if (session.context.tasks.length > 0) score += 0.1;
    if (session.context.artifacts.length > 0) score += 0.1;
    if (session.context.keyDecisions.length > 0) score += 0.05;
    if (session.checkpoints.length > 0) score += 0.05;

    // 状态明确性加成
    if (session.status === 'active') score += 0.1;
    if (session.status === 'completed') score += 0.15;

    // 时间新鲜度加成（最近更新的）
    const age = Date.now() - session.updatedAt;
    if (age < 60 * 60 * 1000) score += 0.1; // 1小时内
    else if (age < 24 * 60 * 60 * 1000) score += 0.05; // 1天内

    return Math.min(0.95, Math.max(0.3, score));
  }

  // ============== Task 摘要生成 ==============

  /**
   * 为Task生成简短摘要
   */
  summarizeTask(task: {
    id: string;
    title: string;
    status: string;
    priority: string;
    assignee?: string;
    subtasks?: { completed: boolean }[];
    dependencies?: string[];
  }): TaskSummary {
    // 状态描述
    let status = '';
    switch (task.status) {
      case 'done':
        status = '已完成';
        break;
      case 'in-progress':
        if (task.subtasks && task.subtasks.length > 0) {
          const completed = task.subtasks.filter(s => s.completed).length;
          status = `进行中（${completed}/${task.subtasks.length}子任务完成）`;
        } else {
          status = '进行中';
        }
        break;
      case 'blocked':
        status = '被阻塞';
        break;
      case 'todo':
        status = '待开始';
        break;
      case 'backlog':
        status = '在Backlog中';
        break;
      default:
        status = task.status;
    }

    // 剩余工作量
    let remainingWork = '';
    if (task.status === 'done') {
      remainingWork = '无';
    } else if (task.status === 'todo' || task.status === 'backlog') {
      remainingWork = task.priority === 'critical' ? '高优，待处理' : '正常';
    } else {
      remainingWork = '进行中';
    }

    // 下一步行动
    let nextStep = '';
    if (task.status === 'done') {
      nextStep = '任务已完成';
    } else if (task.status === 'blocked') {
      nextStep = '解除阻塞';
    } else if (task.subtasks && task.subtasks.length > 0) {
      const nextSubtask = task.subtasks.findIndex(s => !s.completed);
      nextStep = nextSubtask >= 0 ? `完成子任务 ${nextSubtask + 1}` : '所有子任务完成';
    } else if (task.dependencies && task.dependencies.length > 0) {
      nextStep = '等待依赖任务完成';
    } else if (task.status === 'todo') {
      nextStep = '开始执行';
    } else {
      nextStep = '继续当前工作';
    }

    return {
      taskId: task.id,
      status,
      remainingWork,
      nextStep,
      confidence: 0.85
    };
  }

  // ============== LLM 增强摘要（可选） ==============

  /**
   * 使用LLM生成更智能的摘要（如果配置了API Key）
   */
  async generateLLMSummary(session: Session): Promise<string | null> {
    if (!this.apiKey) {
      return null; // 没有API Key，使用规则引擎
    }

    try {
      // 构建prompt
      const prompt = `请为以下Session生成3句话摘要，格式如下：
      进度：[一句话描述当前进度]
      阻碍：[一句话描述当前阻碍，没有则写"暂无明确阻碍"]
      下一步：[一句话建议下一步行动]

      Session信息：
      - 名称：${session.name}
      - 状态：${session.status}
      - 类型：${session.type}
      - 涉及文件：${session.context.files.join(', ') || '无'}
      - 关联任务：${session.context.tasks.length}个
      - 产出物：${session.context.artifacts.length}个
      - 关键决策：${session.context.keyDecisions.join(', ') || '无'}
      - 阻碍因素：${session.context.blockers.join(', ') || '无'}
      - 快照数量：${session.checkpoints.length}个`;

      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`
        },
        body: JSON.stringify({
          model: 'glm-4',
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 200
        })
      });

      if (!response.ok) {
        console.error('LLM API error:', response.status);
        return null;
      }

      const data = await response.json();
      return data.choices?.[0]?.message?.content || null;
    } catch (error) {
      console.error('LLM summarization error:', error);
      return null;
    }
  }
}
