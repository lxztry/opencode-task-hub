/**
 * OpenCode Task Hub - Task Manager
 * AI-powered task management for development teams
 */

export interface Task {
  id: string;
  title: string;
  description: string;
  status: 'todo' | 'in-progress' | 'done';
  priority: 'low' | 'medium' | 'high' | 'critical';
  assignee?: string;
  tags: string[];
  createdAt: number;
  updatedAt: number;
  estimatedHours?: number;
  actualHours?: number;
}

export interface TeamMember {
  id: string;
  name: string;
  skills: string[];
  availability: number; // 0-100%
  currentTasks: number;
}

export interface Board {
  todo: Task[];
  inProgress: Task[];
  done: Task[];
}

export class TaskManager {
  private tasks: Task[] = [];
  private members: TeamMember[] = [];
  
  constructor() {
    // Initialize with sample data
    this.initializeSampleData();
  }
  
  private initializeSampleData() {
    this.members = [
      { id: 'dev-001', name: 'Alice', skills: ['frontend', 'react'], availability: 80, currentTasks: 2 },
      { id: 'dev-002', name: 'Bob', skills: ['backend', 'python'], availability: 60, currentTasks: 3 },
      { id: 'dev-003', name: 'Charlie', skills: ['fullstack', 'typescript'], availability: 100, currentTasks: 1 },
    ];
  }
  
  // Task CRUD
  createTask(task: Omit<Task, 'id' | 'createdAt' | 'updatedAt'>): Task {
    const newTask: Task = {
      ...task,
      id: `task-${Date.now()}`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      status: task.status || 'todo',
      tags: task.tags || []
    };
    this.tasks.push(newTask);
    return newTask;
  }
  
  getTask(id: string): Task | undefined {
    return this.tasks.find(t => t.id === id);
  }
  
  updateTask(id: string, updates: Partial<Task>): Task | undefined {
    const task = this.getTask(id);
    if (!task) return undefined;
    
    Object.assign(task, updates, { updatedAt: Date.now() });
    return task;
  }
  
  deleteTask(id: string): boolean {
    const index = this.tasks.findIndex(t => t.id === id);
    if (index === -1) return false;
    this.tasks.splice(index, 1);
    return true;
  }
  
  getAllTasks(): Task[] {
    return [...this.tasks];
  }
  
  // Kanban Board
  getBoard(): Board {
    return {
      todo: this.tasks.filter(t => t.status === 'todo'),
      inProgress: this.tasks.filter(t => t.status === 'in-progress'),
      done: this.tasks.filter(t => t.status === 'done')
    };
  }
  
  // AI Task Assignment
  async suggestAssignee(taskId: string): Promise<{
    assigneeId: string;
    assigneeName: string;
    confidence: number;
    reason: string;
  } | null> {
    const task = this.getTask(taskId);
    if (!task) return null;
    
    // Simple matching algorithm
    const taskTags = task.tags;
    
    let bestMatch: TeamMember | null = null;
    let bestScore = 0;
    
    for (const member of this.members) {
      const skillMatch = member.skills.filter(s => 
        taskTags.some(t => t.toLowerCase().includes(s))
      ).length;
      
      const availabilityScore = member.availability / 100;
      const workloadScore = 1 - (member.currentTasks / 10);
      
      const score = (skillMatch * 0.5) + (availabilityScore * 0.3) + (workloadScore * 0.2);
      
      if (score > bestScore) {
        bestScore = score;
        bestMatch = member;
      }
    }
    
    if (!bestMatch) {
      return {
        assigneeId: this.members[0].id,
        assigneeName: this.members[0].name,
        confidence: 0.1,
        reason: 'Default assignment (no strong match)'
      };
    }
    
    return {
      assigneeId: bestMatch.id,
      assigneeName: bestMatch.name,
      confidence: Math.min(0.95, bestScore),
      reason: `Best match based on skills (${bestMatch.skills.join(', ')}) and availability (${bestMatch.availability}%)`
    };
  }
  
  // Time Estimation
  estimateTaskDuration(task: Task): number {
    // Simple heuristic based on priority and complexity
    const baseHours = {
      'low': 2,
      'medium': 4,
      'high': 8,
      'critical': 16
    };
    
    let hours = baseHours[task.priority];
    
    // Adjust for tags complexity
    if (task.tags.length > 3) hours *= 1.5;
    if (task.description.length > 200) hours *= 1.2;
    
    return Math.ceil(hours);
  }
  
  // Analytics
  getAnalytics(): {
    totalTasks: number;
    completedTasks: number;
    inProgressTasks: number;
    completionRate: number;
    averagePriority: number;
    tasksByAssignee: Record<string, number>;
  } {
    const completed = this.tasks.filter(t => t.status === 'done');
    const inProgress = this.tasks.filter(t => t.status === 'in-progress');
    
    const priorityValues = { low: 1, medium: 2, high: 3, critical: 4 };
    
    return {
      totalTasks: this.tasks.length,
      completedTasks: completed.length,
      inProgressTasks: inProgress.length,
      completionRate: this.tasks.length > 0 
        ? Math.round((completed.length / this.tasks.length) * 100) 
        : 0,
      averagePriority: this.tasks.length > 0
        ? Object.values(priorityValues).reduce((sum, p) => sum + p, 0) / this.tasks.length
        : 0,
      tasksByAssignee: this.tasks.reduce((acc, t) => {
        if (t.assignee) {
          acc[t.assignee] = (acc[t.assignee] || 0) + 1;
        }
        return acc;
      }, {} as Record<string, number>)
    };
  }
}

export default TaskManager;
