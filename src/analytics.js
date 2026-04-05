/**
 * OpenCode Task Hub - Analytics & Reports
 * Sprint metrics, burndown charts, team performance
 */

import { Task, TimeEntry, TeamMember, Session } from './types.js';

interface BurndownPoint {
  date: number;
  remaining: number;
  completed: number;
  ideal: number;
}

interface VelocityData {
  sprintId: string;
  startDate: number;
  endDate: number;
  committed: number;
  completed: number;
  velocity: number;
}

interface TeamPerformance {
  memberId: string;
  memberName: string;
  tasksCompleted: number;
  pointsCompleted: number;
  averageTaskDuration: number;
  efficiency: number;
  utilization: number;
}

interface SprintReport {
  sprintId: string;
  sprintName: string;
  startDate: number;
  endDate: number;
  totalTasks: number;
  completedTasks: number;
  inProgressTasks: number;
  blockedTasks: number;
  totalEstimatedHours: number;
  actualHours: number;
  completionRate: number;
  velocity: number;
  burndown: BurndownPoint[];
  teamPerformance: TeamPerformance[];
  topRisks: string[];
  recommendations: string[];
}

export class Analytics {
  private tasks: Task[] = [];
  private timeEntries: TimeEntry[] = [];
  private teamMembers: TeamMember[] = [];
  private sessions: Session[] = [];

  updateData(tasks: Task[], timeEntries: TimeEntry[], teamMembers: TeamMember[], sessions: Session[]): void {
    this.tasks = tasks;
    this.timeEntries = timeEntries;
    this.teamMembers = teamMembers;
    this.sessions = sessions;
  }

  // ============== Burndown Chart Data ==============

  generateBurndown(
    startDate: number,
    endDate: number,
    totalPoints: number
  ): BurndownPoint[] {
    const points: BurndownPoint[] = [];
    const dayMs = 86400000;
    
    const totalDays = Math.ceil((endDate - startDate) / dayMs);
    const idealDailyReduction = totalPoints / totalDays;

    let currentDate = startDate;
    let remaining = totalPoints;

    // 统计每天完成的任务
    const completedByDay = new Map<number, number>();
    for (const task of this.tasks.filter(t => t.status === 'done' && t.completedAt)) {
      const dayKey = Math.floor((task.completedAt! - startDate) / dayMs);
      completedByDay.set(dayKey, (completedByDay.get(dayKey) || 0) + 1);
    }

    for (let i = 0; i <= totalDays; i++) {
      const date = startDate + i * dayMs;
      const dayCompleted = completedByDay.get(i) || 0;
      remaining -= dayCompleted;

      points.push({
        date,
        remaining: Math.max(0, remaining),
        completed: totalPoints - Math.max(0, remaining),
        ideal: Math.max(0, totalPoints - idealDailyReduction * i)
      });
    }

    return points;
  }

  // ============== Sprint Velocity ==============

  calculateVelocity(sprintId: string, days: number = 14): VelocityData {
    const startDate = Date.now() - days * 86400000;
    const endDate = Date.now();

    const sprintTasks = this.tasks.filter(t => {
      const created = t.createdAt >= startDate && t.createdAt <= endDate;
      const hasTag = t.tags?.includes(`sprint-${sprintId}`);
      return created && (hasTag || !t.sessionId);
    });

    const committed = sprintTasks.length;
    const completed = sprintTasks.filter(t => t.status === 'done').length;

    // 计算points
    const getPoints = (task: Task): number => {
      const base = { low: 1, medium: 2, high: 3, critical: 5 };
      return base[task.priority] || 2;
    };

    const committedPoints = sprintTasks.reduce((sum, t) => sum + getPoints(t), 0);
    const completedPoints = sprintTasks.filter(t => t.status === 'done')
      .reduce((sum, t) => sum + getPoints(t), 0);

    return {
      sprintId,
      startDate,
      endDate,
      committed: committedPoints,
      completed: completedPoints,
      velocity: committedPoints > 0 ? (completedPoints / committedPoints) * 100 : 0
    };
  }

  // ============== Team Performance ==============

  getTeamPerformance(days: number = 30): TeamPerformance[] {
    const startDate = Date.now() - days * 86400000;

    return this.teamMembers.map(member => {
      const memberTasks = this.tasks.filter(t => 
        t.assignee === member.id && 
        t.status === 'done' &&
        t.completedAt &&
        t.completedAt >= startDate
      );

      const memberTimeEntries = this.timeEntries.filter(e => 
        e.userId === member.id &&
        e.date >= startDate
      );

      // 计算平均任务时长
      let totalDuration = 0;
      for (const task of memberTasks) {
        if (task.completedAt && task.createdAt) {
          totalDuration += (task.completedAt - task.createdAt) / 86400000; // 转换为天
        }
      }
      const avgDuration = memberTasks.length > 0 ? totalDuration / memberTasks.length : 0;

      // 计算工时效率
      const estimatedHours = memberTasks.reduce((sum, t) => sum + (t.estimatedHours || 4), 0);
      const actualHours = memberTimeEntries.reduce((sum, e) => sum + e.hours, 0);
      const efficiency = estimatedHours > 0 ? (estimatedHours / actualHours) * 100 : 0;

      // 计算利用率
      const availableHours = days * 8; // 假设每天8小时
      const utilization = availableHours > 0 ? (actualHours / availableHours) * 100 : 0;

      // 计算points
      const getPoints = (task: Task): number => {
        const base = { low: 1, medium: 2, high: 3, critical: 5 };
        return base[task.priority] || 2;
      };
      const completedPoints = memberTasks.reduce((sum, t) => sum + getPoints(t), 0);

      return {
        memberId: member.id,
        memberName: member.name,
        tasksCompleted: memberTasks.length,
        pointsCompleted: completedPoints,
        averageTaskDuration: Math.round(avgDuration * 10) / 10,
        efficiency: Math.round(efficiency),
        utilization: Math.round(utilization)
      };
    });
  }

  // ============== Sprint Report ==============

  generateSprintReport(
    sprintId: string,
    sprintName: string,
    startDate: number,
    endDate: number
  ): SprintReport {
    const sprintTasks = this.tasks.filter(t => 
      t.tags?.includes(`sprint-${sprintId}`) ||
      (t.createdAt >= startDate && t.createdAt <= endDate)
    );

    const completedTasks = sprintTasks.filter(t => t.status === 'done');
    const inProgressTasks = sprintTasks.filter(t => t.status === 'in-progress');
    const blockedTasks = sprintTasks.filter(t => t.status === 'blocked');

    // 工时统计
    const totalEstimatedHours = sprintTasks.reduce((sum, t) => sum + (t.estimatedHours || 4), 0);
    const actualHours = sprintTasks.reduce((sum, t) => sum + (t.actualHours || 0), 0);

    // 完成率
    const completionRate = sprintTasks.length > 0 
      ? Math.round((completedTasks.length / sprintTasks.length) * 100)
      : 0;

    // 燃尽图
    const totalPoints = sprintTasks.length;
    const burndown = this.generateBurndown(startDate, endDate, totalPoints);

    // 团队表现
    const teamPerformance = this.getTeamPerformance(
      Math.ceil((endDate - startDate) / 86400000)
    );

    // Velocity
    const velocityData = this.calculateVelocity(sprintId, Math.ceil((endDate - startDate) / 86400000));

    // 风险识别
    const topRisks: string[] = [];
    if (blockedTasks.length > 0) {
      topRisks.push(`${blockedTasks.length}个任务被阻塞`);
    }
    if (completionRate < 70 && Date.now() > endDate) {
      topRisks.push(`完成率仅${completionRate}%，低于目标`);
    }
    if (inProgressTasks.length > blockedTasks.length * 3) {
      topRisks.push('进行中的任务过多，可能存在协调问题');
    }

    // 建议
    const recommendations: string[] = [];
    if (completionRate < 80) {
      recommendations.push('建议下次sprint减少20%的承诺量');
    }
    if (teamPerformance.some(p => p.efficiency < 50)) {
      recommendations.push('存在效率较低的成员，建议进行一对一辅导');
    }
    if (blockedTasks.length > 0) {
      recommendations.push('优先解决阻塞问题，避免影响整体进度');
    }

    return {
      sprintId,
      sprintName,
      startDate,
      endDate,
      totalTasks: sprintTasks.length,
      completedTasks: completedTasks.length,
      inProgressTasks: inProgressTasks.length,
      blockedTasks: blockedTasks.length,
      totalEstimatedHours,
      actualHours,
      completionRate,
      velocity: Math.round(velocityData.velocity),
      burndown,
      teamPerformance,
      topRisks,
      recommendations
    };
  }

  // ============== Time Tracking Report ==============

  getTimeReport(userId?: string, startDate?: number, endDate?: number): {
    totalHours: number;
    byTask: { taskId: string; taskTitle: string; hours: number }[];
    byDay: { date: number; hours: number }[];
    byMember: { memberId: string; memberName: string; hours: number }[];
  } {
    let entries = this.timeEntries;

    if (userId) {
      entries = entries.filter(e => e.userId === userId);
    }
    if (startDate) {
      entries = entries.filter(e => e.date >= startDate);
    }
    if (endDate) {
      entries = entries.filter(e => e.date <= endDate);
    }

    const totalHours = entries.reduce((sum, e) => sum + e.hours, 0);

    // 按任务分组
    const byTaskMap = new Map<string, number>();
    for (const entry of entries) {
      byTaskMap.set(entry.taskId, (byTaskMap.get(entry.taskId) || 0) + entry.hours);
    }
    const byTask = Array.from(byTaskMap.entries()).map(([taskId, hours]) => {
      const task = this.tasks.find(t => t.id === taskId);
      return {
        taskId,
        taskTitle: task?.title || 'Unknown',
        hours
      };
    });

    // 按天分组
    const byDayMap = new Map<number, number>();
    for (const entry of entries) {
      const dayKey = Math.floor(entry.date / 86400000) * 86400000;
      byDayMap.set(dayKey, (byDayMap.get(dayKey) || 0) + entry.hours);
    }
    const byDay = Array.from(byDayMap.entries()).map(([date, hours]) => ({ date, hours }));

    // 按成员分组
    const byMemberMap = new Map<string, number>();
    for (const entry of entries) {
      byMemberMap.set(entry.userId, (byMemberMap.get(entry.userId) || 0) + entry.hours);
    }
    const byMember = Array.from(byMemberMap.entries()).map(([memberId, hours]) => {
      const member = this.teamMembers.find(m => m.id === memberId);
      return {
        memberId,
        memberName: member?.name || 'Unknown',
        hours
      };
    });

    return { totalHours, byTask, byDay, byMember };
  }

  // ============== Export Formats ==============

  exportAsJSON(data: any): string {
    return JSON.stringify(data, null, 2);
  }

  exportAsCSV(report: SprintReport): string {
    const lines: string[] = [];
    
    // Header
    lines.push(`Sprint Report: ${report.sprintName}`);
    lines.push(`Period: ${new Date(report.startDate).toLocaleDateString()} - ${new Date(report.endDate).toLocaleDateString()}`);
    lines.push('');
    
    // Summary
    lines.push('Summary');
    lines.push(`Total Tasks,${report.totalTasks}`);
    lines.push(`Completed,${report.completedTasks}`);
    lines.push(`In Progress,${report.inProgressTasks}`);
    lines.push(`Blocked,${report.blockedTasks}`);
    lines.push(`Completion Rate,${report.completionRate}%`);
    lines.push(`Velocity,${report.velocity}%`);
    lines.push('');

    // Team Performance
    lines.push('Team Performance');
    lines.push('Name,Tasks Completed,Points,Efficiency,Utilization');
    for (const p of report.teamPerformance) {
      lines.push(`${p.memberName},${p.tasksCompleted},${p.pointsCompleted},${p.efficiency}%,${p.utilization}%`);
    }

    return lines.join('\n');
  }
}

export const analytics = new Analytics();
