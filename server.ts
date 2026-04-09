import express from 'express';
import { WebSocketServer } from 'ws';
import cors from 'cors';
import { createServer } from 'http';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3030;
const API_KEY = process.env.API_KEY || '';
const SESSION_TIMEOUT = 5 * 60 * 1000;
const API_KEY_HEADER = 'x-api-key';

function authenticate(req, res, next) {
  if (!API_KEY) return next();
  const providedKey = req.headers[API_KEY_HEADER] || req.query.apiKey;
  if (providedKey !== API_KEY) {
    return res.status(401).json({ error: 'Unauthorized: invalid or missing API key' });
  }
  next();
}

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const DATA_FILE = path.join(__dirname, 'data.json');
let sessions = [];
let tasks = [];

if (fs.existsSync(DATA_FILE)) {
  try {
    const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
    sessions = data.sessions || [];
    tasks = data.tasks || [];
  } catch (e) {
    sessions = [];
    tasks = [];
  }
}

function saveData() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify({ sessions, tasks }, null, 2));
  } catch (e) {
    console.error('Failed to save data:', e);
  }
}

setInterval(saveData, 30000);

app.use('/api/sessions', authenticate);
app.use('/api/tasks', authenticate);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

app.get('/api/processes', (req, res) => {
  exec('tasklist /FO CSV /NH', { encoding: 'utf8' }, (err, stdout) => {
    if (err) return res.status(500).json({ error: err.message });
    const processes = stdout.split('\n')
      .filter(line => line.trim())
      .map(line => {
        const parts = line.split('","');
        if (parts.length >= 2) {
          return {
            name: parts[0].replace(/"/g, ''),
            pid: parseInt(parts[1].replace(/"/g, '')),
            sessionName: parts.length > 4 ? parts[4].replace(/"/g, '') : ''
          };
        }
        return null;
      })
      .filter(p => p && (p.name.toLowerCase().includes('cmd') || p.name.toLowerCase().includes('powershell')));
    res.json({ processes });
  });
});

app.post('/api/processes/:pid/focus', (req, res) => {
  const pid = parseInt(req.params.pid);
  const checkProcess = `powershell -Command "Get-Process -Id ${pid} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty MainWindowHandle"`;
  
  exec(checkProcess, (err, stdout) => {
    const handle = parseInt(stdout.trim());
    
    if (handle && handle > 0) {
      exec(`powershell -Command "Set-ForegroundWindow ${handle}"`, (err2) => {
        if (err2) {
          res.json({ success: false, error: err2.message });
        } else {
          res.json({ success: true, pid });
        }
      });
    } else {
      exec(`powershell -Command "Start-Process -FilePath 'cmd.exe' -ArgumentList '/c echo. &' ; Get-Process -Id ${pid} | ForEach-Object { $_.MainWindowTitle }"`, (err3, stdout3) => {
        res.json({ success: false, error: '无法聚焦窗口，请手动查看', details: stdout3 || err3?.message });
      });
    }
  });
});

app.post('/api/sessions/register', (req, res) => {
  console.log('[SESSION] Register request:', req.body);
  const { sessionId, projectPath, projectName, hostname, name, description, context, cwd, pid } = req.body;
  const projectKey = hostname ? `${hostname}:${projectPath || cwd}` : sessionId;
  const existing = sessions.find(s => s.projectKey === projectKey || s.sessionId === sessionId);
  if (existing) {
    existing.lastActive = Date.now();
    existing.lastHeartbeat = new Date().toISOString();
    existing.status = 'active';
    if (projectName) existing.projectName = projectName;
    if (pid) existing.pid = pid;
    saveData();
    broadcast({ type: 'session:updated', session: existing });
    return res.json(existing);
  }
  const session = {
    id: uuidv4(),
    sessionId,
    projectPath: projectPath || cwd,
    projectKey,
    projectName: projectName || (projectPath ? projectPath.split(/[/\\]/).pop() : 'New Session'),
    hostname: hostname || '',
    status: 'active',
    createdAt: new Date().toISOString(),
    lastHeartbeat: new Date().toISOString(),
    lastActive: '已连接',
    pid: pid || null,
    context: context || {},
    description: description || ''
  };
  sessions.push(session);
  saveData();
  broadcast({ type: 'session:created', session });
  res.json(session);
});

app.post('/api/sessions/:sessionId/heartbeat', (req, res) => {
  let session = sessions.find(s => s.sessionId === req.params.sessionId);
  if (!session && req.body.projectKey) {
    session = sessions.find(s => s.projectKey === req.body.projectKey);
  }
  if (session) {
    session.sessionId = req.params.sessionId;
    if (req.body.projectName) session.projectName = req.body.projectName;
    if (req.body.pid) session.pid = req.body.pid;
    session.lastHeartbeat = new Date().toISOString();
    session.status = 'active';
    saveData();
    broadcast({ type: 'session:updated', session });
  }
  res.json({ ok: true });
});

app.post('/api/sessions/:sessionId/log', (req, res) => {
  let session = sessions.find(s => s.sessionId === req.params.sessionId);
  if (!session && req.body.projectKey) {
    session = sessions.find(s => s.projectKey === req.body.projectKey);
  }
  if (session) {
    session.sessionId = req.params.sessionId;
    session.lastActivity = req.body.description || req.body.action || '进行中';
    session.lastHeartbeat = new Date().toISOString();
    if (!session.activities) session.activities = [];
    session.activities.unshift({
      description: req.body.description || req.body.action || '进行中',
      timestamp: new Date().toISOString()
    });
    if (session.activities.length > 50) session.activities = session.activities.slice(0, 50);
    saveData();
    broadcast({ type: 'activity', session });
  }
  res.json({ ok: true });
});

app.get('/api/sessions', (req, res) => {
  let filteredSessions = sessions;
  if (req.query.projectName) {
    const searchName = req.query.projectName.toLowerCase();
    filteredSessions = sessions.filter(s => 
      s.projectName.toLowerCase().includes(searchName)
    );
  }
  const totalInput = sessions.reduce((sum, s) => sum + (s.tokenUsage?.inputTokens || 0), 0);
  const totalOutput = sessions.reduce((sum, s) => sum + (s.tokenUsage?.outputTokens || 0), 0);
  const totalTokens = sessions.reduce((sum, s) => sum + (s.tokenUsage?.totalTokens || 0), 0);
  
  res.json({ 
    sessions: filteredSessions,
    tokenUsageSummary: {
      totalInputTokens: totalInput,
      totalOutputTokens: totalOutput,
      totalTokens: totalTokens,
      sessionCount: sessions.length,
      totalRatePerSecond: 0,
      totalRatePerMinute: 0
    }
  });
});

app.get('/api/tasks', (req, res) => {
  res.json({ tasks, sessions });
});

app.post('/api/tasks', authenticate, (req, res) => {
  const task = { id: uuidv4(), ...req.body, createdAt: Date.now(), updatedAt: Date.now() };
  tasks.push(task);
  res.status(201).json(task);
});

app.patch('/api/tasks/:id', authenticate, (req, res) => {
  const task = tasks.find(t => t.id === req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  Object.assign(task, req.body, { updatedAt: Date.now() });
  res.json(task);
});

app.delete('/api/tasks/:id', authenticate, (req, res) => {
  const idx = tasks.findIndex(t => t.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Task not found' });
  tasks.splice(idx, 1);
  res.status(204).send();
});

// ============== Long-Running Task System ==============

interface LongRunningTask {
  id: string;
  title: string;
  description: string;
  status: 'planning' | 'pending' | 'running' | 'paused' | 'completed' | 'failed';
  progress: number;         // 0-100
  checkpoints: TaskCheckpoint[];
  subtasks: SubTask[];
  plan: TaskPlan;
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  completedAt?: number;
  estimatedHours: number;
  actualHours: number;
  sessionId?: string;
  projectKey?: string;
  metadata: {
    priority: 'low' | 'medium' | 'high' | 'critical';
    tags: string[];
    assignees: string[];
    dependencies: string[];
    blockers: string[];
    autoExpand: boolean;     // 自动拆解子任务
    selfPlanning: boolean;   // 自我规划
  };
}

interface TaskCheckpoint {
  id: string;
  name: string;
  timestamp: number;
  progress: number;
  state: any;  // 当时的任务状态快照
  note?: string;
}

interface SubTask {
  id: string;
  title: string;
  status: 'pending' | 'in_progress' | 'completed' | 'skipped';
  progress: number;
  priority: 'low' | 'medium' | 'high' | 'critical';
  assignee?: string;
  dependencies: string[];
  createdAt: number;
  completedAt?: number;
  notes?: string;
}

interface TaskPlan {
  steps: PlanStep[];
  currentStep: number;
  totalSteps: number;
  estimatedMinutes: number;
  actualMinutes: number;
}

interface PlanStep {
  id: string;
  name: string;
  description: string;
  status: 'pending' | 'in_progress' | 'completed' | 'skipped';
  estimatedMinutes: number;
  actualMinutes: number;
  startedAt?: number;
  completedAt?: number;
  result?: string;
}

const longRunningTasks: Map<string, LongRunningTask> = new Map();

// 自动规划引擎
class TaskPlanner {
  static analyzeAndPlan(task: Partial<LongRunningTask>): TaskPlan {
    const title = task.title || '';
    const description = task.description || '';
    const combined = title + ' ' + description;
    
    // 基于关键词生成计划步骤
    const steps: PlanStep[] = [];
    
    // 检测任务类型并生成对应步骤
    if (/代码|code|开发|开发|实现|功能|feature/i.test(combined)) {
      steps.push(
        { id: uuidv4(), name: '需求分析', description: '理解任务需求，明确功能点', status: 'pending', estimatedMinutes: 30 },
        { id: uuidv4(), name: '技术设计', description: '设计技术方案，确定实现路径', status: 'pending', estimatedMinutes: 45 },
        { id: uuidv4(), name: '代码实现', description: '编写代码，完成功能开发', status: 'pending', estimatedMinutes: 120 },
        { id: uuidv4(), name: '测试验证', description: '编写测试用例，验证功能', status: 'pending', estimatedMinutes: 45 },
        { id: uuidv4(), name: '代码审查', description: 'Review代码，优化质量', status: 'pending', estimatedMinutes: 30 },
        { id: uuidv4(), name: '文档更新', description: '更新相关文档', status: 'pending', estimatedMinutes: 15 }
      );
    } else if (/bug|修复|fix|错误/i.test(combined)) {
      steps.push(
        { id: uuidv4(), name: '问题定位', description: '复现问题，找到根因', status: 'pending', estimatedMinutes: 30 },
        { id: uuidv4(), name: '修复方案', description: '制定修复方案', status: 'pending', estimatedMinutes: 15 },
        { id: uuidv4(), name: '实施修复', description: '修改代码，修复bug', status: 'pending', estimatedMinutes: 60 },
        { id: uuidv4(), name: '验证测试', description: '验证修复有效', status: 'pending', estimatedMinutes: 30 }
      );
    } else if (/文档|docs?|说明|readme|写作/i.test(combined)) {
      steps.push(
        { id: uuidv4(), name: '内容规划', description: '规划文档结构和内容', status: 'pending', estimatedMinutes: 20 },
        { id: uuidv4(), name: '撰写初稿', description: '完成文档初稿', status: 'pending', estimatedMinutes: 60 },
        { id: uuidv4(), name: '审核校对', description: '审核内容，校对文字', status: 'pending', estimatedMinutes: 20 }
      );
    } else {
      // 默认计划
      steps.push(
        { id: uuidv4(), name: '调研准备', description: '收集信息，准备材料', status: 'pending', estimatedMinutes: 30 },
        { id: uuidv4(), name: '执行主体', description: '完成任务主体工作', status: 'pending', estimatedMinutes: 90 },
        { id: uuidv4(), name: '收尾整理', description: '整理结果，完成收尾', status: 'pending', estimatedMinutes: 15 }
      );
    }
    
    const totalMinutes = steps.reduce((sum, s) => sum + s.estimatedMinutes, 0);
    
    return {
      steps,
      currentStep: 0,
      totalSteps: steps.length,
      estimatedMinutes: totalMinutes,
      actualMinutes: 0
    };
  }
  
  static async autoExpandTask(task: LongRunningTask): Promise<SubTask[]> {
    const subtasks: SubTask[] = [];
    const plan = task.plan;
    
    // 根据计划步骤自动拆解子任务
    for (const step of plan.steps) {
      const subtask: SubTask = {
        id: uuidv4(),
        title: `[${task.title}] ${step.name}`,
        status: 'pending',
        progress: 0,
        priority: task.metadata.priority,
        dependencies: [],
        createdAt: Date.now(),
        notes: step.description
      };
      subtasks.push(subtask);
    }
    
    return subtasks;
  }
  
  static calculateProgress(task: LongRunningTask): number {
    if (!task.plan || task.plan.steps.length === 0) return 0;
    
    let totalWeight = 0;
    let completedWeight = 0;
    
    for (const step of task.plan.steps) {
      const weight = step.estimatedMinutes;
      totalWeight += weight;
      
      if (step.status === 'completed') {
        completedWeight += weight;
      } else if (step.status === 'in_progress' && step.actualMinutes) {
        // 进行中的步骤按实际时间比例计算
        completedWeight += Math.min(step.actualMinutes / step.estimatedMinutes, 1) * weight;
      }
    }
    
    return totalWeight > 0 ? Math.round((completedWeight / totalWeight) * 100) : 0;
  }
}

// ============== Session Health Calculator ==============

interface SessionHealth {
  sessionId: string;
  health: number;           // 0-100
  progress: number;          // 0-100%
  velocity: number;         // tokens/min
  blockers: number;         // 阻塞任务数
  type: 'sprint' | 'feature' | 'bug' | 'explore';
  priority: 'low' | 'medium' | 'high' | 'critical';
  duration: number;         // ms
  lastMeaningfulAction: number;
  summary: string;          // 3句话摘要
}

function calculateSessionHealth(session: any, sessionTasks: any[]): SessionHealth {
  const now = Date.now();
  const createdAt = new Date(session.createdAt).getTime();
  const duration = now - createdAt;
  
  // 基本分数
  let health = 50;
  
  // 进度加分：已完成任务 / 总任务
  const completedTasks = sessionTasks.filter(t => t.status === 'completed').length;
  const totalTasks = sessionTasks.length;
  const progress = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;
  health += progress * 0.2;
  
  // 无阻塞加分
  const blockerTasks = sessionTasks.filter(t => 
    t.status !== 'completed' && 
    (t.blockers?.length > 0 || t.description?.includes('阻塞') || t.description?.includes('blocker'))
  ).length;
  health += blockerTasks === 0 ? 20 : Math.max(0, 20 - blockerTasks * 5);
  
  // 活跃度加分（30分钟内有过活动）
  const lastActivity = session.lastHeartbeat ? new Date(session.lastHeartbeat).getTime() : createdAt;
  const inactiveTime = now - lastActivity;
  if (inactiveTime < 30 * 60 * 1000) {
    health += 10;
  } else if (inactiveTime > 2 * 60 * 60 * 1000) {
    health -= 10;
  }
  
  // Token 速率计算
  const tokenUsage = session.tokenUsage || {};
  const totalTokens = tokenUsage.totalTokens || 0;
  const durationMin = duration / 60000;
  const velocity = durationMin > 0 ? Math.round(totalTokens / durationMin) : 0;
  
  // 类型识别（基于名称/描述）
  let type: SessionHealth['type'] = 'feature';
  const nameLower = (session.projectName || '').toLowerCase();
  const descLower = (session.description || '').toLowerCase();
  if (nameLower.includes('bug') || descLower.includes('bug') || nameLower.includes('修复')) {
    type = 'bug';
  } else if (nameLower.includes('sprint') || nameLower.includes('迭代')) {
    type = 'sprint';
  } else if (nameLower.includes('explore') || nameLower.includes('探索') || nameLower.includes('research')) {
    type = 'explore';
  }
  
  // 优先级（基于活跃度和进度）
  let priority: SessionHealth['priority'] = 'medium';
  if (health < 40) priority = 'critical';
  else if (health < 60) priority = 'high';
  else if (health > 80 && progress > 50) priority = 'low';
  
  // 生成3句话摘要
  const summary = generateSessionSummary(session, sessionTasks, progress, completedTasks, totalTasks, blockerTasks, velocity);
  
  return {
    sessionId: session.id,
    health: Math.min(100, Math.max(0, Math.round(health))),
    progress,
    velocity,
    blockers: blockerTasks,
    type,
    priority,
    duration,
    lastMeaningfulAction: lastActivity,
    summary
  };
}

function generateSessionSummary(session: any, tasks: any[], progress: number, completed: number, total: number, blockers: number, velocity: number): string {
  const sentences: string[] = [];
  
  // 第一句：当前状态
  const inProgressTasks = tasks.filter(t => t.status === 'in_progress');
  if (inProgressTasks.length > 0) {
    sentences.push(`正在进行「${inProgressTasks[0].title || '未知任务'}」`);
  } else if (completed > 0) {
    sentences.push(`已完成 ${completed}/${total} 个任务`);
  } else {
    sentences.push(`会话已创建，等待开始`);
  }
  
  // 第二句：阻塞/风险
  if (blockers > 0) {
    sentences.push(`遇到 ${blockers} 个阻塞项`);
  } else if (velocity > 5000) {
    sentences.push(`Token消耗速率较快 (${velocity}/min)`);
  } else {
    sentences.push(`进度正常`);
  }
  
  // 第三句：建议
  if (blockers > 0) {
    sentences.push(`建议优先解决阻塞问题`);
  } else if (progress > 80) {
    sentences.push(`即将完成，可考虑收尾`);
  } else if (progress < 20 && tasks.length > 5) {
    sentences.push(`任务较多，建议拆解`);
  } else {
    sentences.push(`继续推进当前任务`);
  }
  
  return sentences.join('。') + '。';
}

// ============== Natural Language Task Parser ==============

interface ParsedTask {
  title: string;
  description?: string;
  priority?: 'low' | 'medium' | 'high' | 'critical';
  tags?: string[];
  type?: 'feature' | 'bug' | 'refactor' | 'docs';
}

function parseNaturalLanguageToTask(text: string): ParsedTask | null {
  const trimmed = text.trim();
  if (trimmed.length < 3) return null;
  
  const result: ParsedTask = {
    title: trimmed,
    tags: []
  };
  
  // 优先级识别
  const priorityPatterns = [
    { pattern: /紧急|urgent|critical|immediate/i, priority: 'critical' as const },
    { pattern: /重要|important|high/i, priority: 'high' as const },
    { pattern: /低|low|次要|minor/i, priority: 'low' as const },
    { pattern: /一般|普通|normal|medium/i, priority: 'medium' as const }
  ];
  
  for (const { pattern, priority } of priorityPatterns) {
    if (pattern.test(trimmed)) {
      result.priority = priority;
      break;
    }
  }
  
  // 类型识别
  const typePatterns = [
    { pattern: /bug|缺陷|错误|修复/i, type: 'bug' as const },
    { pattern: /重构|refactor|优化/i, type: 'refactor' as const },
    { pattern: /文档|docs?|说明|readme/i, type: 'docs' as const },
    { pattern: /功能|feature|新增|创建|实现/i, type: 'feature' as const }
  ];
  
  for (const { pattern, type } of typePatterns) {
    if (pattern.test(trimmed)) {
      result.type = type;
      result.tags?.push(type);
      break;
    }
  }
  
  // 从"创建XXX功能"提取标题
  const createMatch = trimmed.match(/创建(?:一个)?(?:新的)?(?:功能|module|组件)?[:：]?\s*(.+)/i);
  if (createMatch) {
    result.title = createMatch[1].trim();
    result.tags?.push('feature');
  }
  
  // 从"完成XXX"提取标题
  const completeMatch = trimmed.match(/完成(?:了)?(?::|：)?\s*(.+)/i);
  if (completeMatch) {
    result.title = `完成 ${completeMatch[1].trim()}`;
  }
  
  // 从"修复XXX bug"提取标题
  const fixMatch = trimmed.match(/修复(?:一个)?(?:bug)?[:：]?\s*(.+)/i);
  if (fixMatch) {
    result.title = `修复 ${fixMatch[1].trim()}`;
    result.tags = ['bug', 'fix'];
    result.priority = result.priority || 'high';
  }
  
  return result;
}

// ============== Cognitive Load APIs (Phase 1-3) ==============

const cognitiveData = {
  progress: new Map(),
  summaries: new Map(),
  confidence: {
    history: [],
    pending: [],
    currentScore: 0.5
  },
  sops: [],
  decisions: {
    rules: [],
    logs: []
  }
};

function getCognitiveDataPath(filename) {
  const dir = path.join(__dirname, 'data', 'cognitive');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, filename);
}

function loadCognitiveData() {
  try {
    const files = ['sops.json', 'decisions.json', 'confidence.json'];
    for (const file of files) {
      const filePath = getCognitiveDataPath(file);
      if (fs.existsSync(filePath)) {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        if (file === 'sops.json') cognitiveData.sops = data;
        if (file === 'decisions.json') cognitiveData.decisions.rules = data;
        if (file === 'confidence.json') cognitiveData.confidence = data;
      }
    }
  } catch (e) {
    console.log('Loading cognitive data:', e.message);
  }
}

function saveCognitiveData() {
  try {
    fs.writeFileSync(getCognitiveDataPath('sops.json'), JSON.stringify(cognitiveData.sops, null, 2));
    fs.writeFileSync(getCognitiveDataPath('decisions.json'), JSON.stringify(cognitiveData.decisions.rules, null, 2));
    fs.writeFileSync(getCognitiveDataPath('confidence.json'), JSON.stringify(cognitiveData.confidence, null, 2));
  } catch (e) {
    console.error('Failed to save cognitive data:', e);
  }
}

loadCognitiveData();

// Phase 1: Progress Memory APIs
app.get('/api/cognitive/progress/:userId', (req, res) => {
  const position = cognitiveData.progress.get(req.params.userId) || { userId: req.params.userId };
  res.json(position);
});

app.post('/api/cognitive/progress/:userId', (req, res) => {
  cognitiveData.progress.set(req.params.userId, req.body);
  res.json({ success: true });
});

app.post('/api/cognitive/progress/:userId/mark-session/:sessionId', (req, res) => {
  const userProgress = cognitiveData.progress.get(req.params.userId) || { accessedSessions: [] };
  if (!userProgress.accessedSessions) userProgress.accessedSessions = [];
  if (!userProgress.accessedSessions.includes(req.params.sessionId)) {
    userProgress.accessedSessions.push(req.params.sessionId);
  }
  cognitiveData.progress.set(req.params.userId, userProgress);
  res.json({ success: true });
});

app.get('/api/cognitive/progress/:userId/suggest-next', (req, res) => {
  const userProgress = cognitiveData.progress.get(req.params.userId) || { accessedSessions: [] };
  const accessed = userProgress.accessedSessions || [];
  const nextSession = sessions.find(s => !accessed.includes(s.id));
  res.json({ suggestedSessionId: nextSession?.id });
});

// Phase 2: AI Summarizer APIs
app.get('/api/cognitive/summaries/sessions', (req, res) => {
  const { sessionIds } = req.query;
  const ids = sessionIds ? sessionIds.split(',') : [];
  const summaries = [];
  for (const id of ids) {
    if (cognitiveData.summaries.has(id)) {
      summaries.push(cognitiveData.summaries.get(id));
    }
  }
  res.json({ summaries });
});

app.get('/api/cognitive/summaries/sessions/:sessionId', (req, res) => {
  const summary = cognitiveData.summaries.get(req.params.sessionId);
  if (!summary) return res.status(404).json({ error: 'Session not found' });
  res.json(summary);
});

app.get('/api/cognitive/summaries/tasks/:taskId', (req, res) => {
  const task = tasks.find(t => t.id === req.params.taskId);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  const summary = {
    taskId: task.id,
    title: task.title,
    status: task.status,
    summary: task.description?.substring(0, 200) || ''
  };
  res.json(summary);
});

app.post('/api/cognitive/summaries/invalidate', (req, res) => {
  const { sessionId } = req.body;
  if (sessionId) cognitiveData.summaries.delete(sessionId);
  res.json({ success: true });
});

// Phase 3: Confidence Scorer APIs
app.post('/api/cognitive/confidence/evaluate', (req, res) => {
  const { task, context } = req.body;
  const score = Math.random() * 0.5 + 0.25;
  const result = {
    score,
    level: score > 0.7 ? 'high' : score > 0.4 ? 'medium' : 'low',
    factors: ['代码复杂度', '测试覆盖率', '历史变更'],
    needsConfirmation: score < 0.5
  };
  cognitiveData.confidence.currentScore = score;
  res.json(result);
});

app.post('/api/cognitive/confidence/check', (req, res) => {
  const { taskId, operation } = req.body;
  const needsConfirm = Math.random() > 0.7;
  res.json({ needsConfirmation: needsConfirm });
});

app.get('/api/cognitive/confidence/history', (req, res) => {
  const limit = parseInt(req.query.limit) || 20;
  res.json({ history: cognitiveData.confidence.history.slice(0, limit) });
});

app.get('/api/cognitive/confidence/pending', (req, res) => {
  res.json({ pending: cognitiveData.confidence.pending });
});

app.post('/api/cognitive/confidence/confirm/:changeId', (req, res) => {
  const { confirmed, notes } = req.body;
  const change = cognitiveData.confidence.pending.find(c => c.id === req.params.changeId);
  if (change) {
    change.confirmed = confirmed;
    change.notes = notes;
    change.resolvedAt = new Date().toISOString();
    cognitiveData.confidence.history.unshift(change);
    cognitiveData.confidence.pending = cognitiveData.confidence.pending.filter(c => c.id !== req.params.changeId);
    saveCognitiveData();
  }
  res.json({ success: !!change });
});

app.post('/api/cognitive/confidence/record', (req, res) => {
  const record = {
    id: uuidv4(),
    ...req.body,
    createdAt: new Date().toISOString()
  };
  cognitiveData.confidence.history.unshift(record);
  if (cognitiveData.confidence.history.length > 100) {
    cognitiveData.confidence.history = cognitiveData.confidence.history.slice(0, 100);
  }
  saveCognitiveData();
  res.json(record);
});

app.get('/api/cognitive/confidence/colors', (req, res) => {
  const score = parseFloat(req.query.score) || 0.5;
  let color, label;
  if (score > 0.7) { color = '#22c55e'; label = '高置信度'; }
  else if (score > 0.4) { color = '#f59e0b'; label = '中置信度'; }
  else { color = '#ef4444'; label = '低置信度'; }
  res.json({ color, label });
});

// Phase 4: SOP Manager APIs
app.get('/api/cognitive/sops', (req, res) => {
  const { enabled } = req.query;
  const sops = enabled === 'true' 
    ? cognitiveData.sops.filter(s => s.enabled)
    : cognitiveData.sops;
  res.json({ sops });
});

app.post('/api/cognitive/sops', (req, res) => {
  const sop = {
    id: uuidv4(),
    ...req.body,
    createdAt: new Date().toISOString()
  };
  cognitiveData.sops.push(sop);
  saveCognitiveData();
  res.json(sop);
});

app.get('/api/cognitive/sops/:id', (req, res) => {
  const sop = cognitiveData.sops.find(s => s.id === req.params.id);
  if (!sop) return res.status(404).json({ error: 'SOP not found' });
  res.json(sop);
});

app.put('/api/cognitive/sops/:id', (req, res) => {
  const idx = cognitiveData.sops.findIndex(s => s.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'SOP not found' });
  cognitiveData.sops[idx] = { ...cognitiveData.sops[idx], ...req.body };
  saveCognitiveData();
  res.json(cognitiveData.sops[idx]);
});

app.delete('/api/cognitive/sops/:id', (req, res) => {
  cognitiveData.sops = cognitiveData.sops.filter(s => s.id !== req.params.id);
  saveCognitiveData();
  res.json({ success: true });
});

app.get('/api/cognitive/sops/match/:taskId', (req, res) => {
  const task = tasks.find(t => t.id === req.params.taskId);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  const matched = cognitiveData.sops.find(s => {
    if (!s.enabled) return false;
    if (s.tags && task.tags) {
      return s.tags.some(t => task.tags.includes(t));
    }
    return false;
  });
  res.json({ matchedSOP: matched || null });
});

app.post('/api/cognitive/sops/:id/execute', (req, res) => {
  const { taskId, sessionId } = req.body;
  const execution = {
    id: uuidv4(),
    sopId: req.params.id,
    taskId,
    sessionId,
    currentStep: 0,
    status: 'running',
    startedAt: new Date().toISOString()
  };
  res.json(execution);
});

app.get('/api/cognitive/executions/:id', (req, res) => {
  res.json({ id: req.params.id, status: 'completed' });
});

app.get('/api/cognitive/executions/running', (req, res) => {
  res.json({ executions: [] });
});

app.post('/api/cognitive/executions/:id/advance', (req, res) => {
  res.json({ success: true });
});

// Phase 5: Human Decision Boundary APIs
app.get('/api/cognitive/decisions/rules', (req, res) => {
  const { confirmationRequired } = req.query;
  const rules = confirmationRequired === 'true'
    ? cognitiveData.decisions.rules.filter(r => r.confirmationRequired)
    : cognitiveData.decisions.rules;
  res.json({ rules });
});

app.post('/api/cognitive/decisions/rules', (req, res) => {
  const rule = {
    id: uuidv4(),
    ...req.body,
    createdAt: new Date().toISOString()
  };
  cognitiveData.decisions.rules.push(rule);
  saveCognitiveData();
  res.json(rule);
});

app.get('/api/cognitive/decisions/rules/:id', (req, res) => {
  const rule = cognitiveData.decisions.rules.find(r => r.id === req.params.id);
  if (!rule) return res.status(404).json({ error: 'Rule not found' });
  res.json(rule);
});

app.put('/api/cognitive/decisions/rules/:id', (req, res) => {
  const idx = cognitiveData.decisions.rules.findIndex(r => r.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Rule not found' });
  cognitiveData.decisions.rules[idx] = { ...cognitiveData.decisions.rules[idx], ...req.body };
  saveCognitiveData();
  res.json(cognitiveData.decisions.rules[idx]);
});

app.delete('/api/cognitive/decisions/rules/:id', (req, res) => {
  cognitiveData.decisions.rules = cognitiveData.decisions.rules.filter(r => r.id !== req.params.id);
  saveCognitiveData();
  res.json({ success: true });
});

app.post('/api/cognitive/decisions/evaluate', (req, res) => {
  const { operationType, context } = req.body;
  const matchingRule = cognitiveData.decisions.rules.find(r => 
    r.operationType === operationType && r.enabled
  );
  res.json({
    requiresConfirmation: matchingRule?.confirmationRequired || false,
    rule: matchingRule,
    suggestion: matchingRule ? '请确认此操作' : '可继续'
  });
});

app.post('/api/cognitive/decisions/quick-check', (req, res) => {
  const { operationType, details } = req.body;
  const result = {
    allowed: true,
    reason: '快速检查通过'
  };
  res.json(result);
});

app.post('/api/cognitive/decisions/confirm/:logId', (req, res) => {
  const { confirmedBy, notes } = req.body;
  const log = cognitiveData.decisions.logs.find(l => l.id === req.params.logId);
  if (log) {
    log.confirmed = confirmedBy;
    log.notes = notes;
    log.resolvedAt = new Date().toISOString();
    saveCognitiveData();
  }
  res.json({ success: !!log });
});

app.get('/api/cognitive/decisions/pending', (req, res) => {
  res.json({ pending: cognitiveData.decisions.logs.filter(l => !l.resolvedAt) });
});

// ============== Long-Running Task APIs ==============

// 创建长跑任务
app.post('/api/long-tasks', (req, res) => {
  const { title, description, priority, tags, sessionId, projectKey, autoExpand, selfPlanning } = req.body;
  
  if (!title) {
    return res.status(400).json({ error: 'Title is required' });
  }
  
  const id = `longtask_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const now = Date.now();
  
  // 自动生成计划
  const plan = TaskPlanner.analyzeAndPlan({ title, description });
  
  const task: LongRunningTask = {
    id,
    title,
    description: description || '',
    status: selfPlanning ? 'planning' : 'pending',
    progress: 0,
    checkpoints: [],
    subtasks: [],
    plan,
    createdAt: now,
    updatedAt: now,
    estimatedHours: Math.round(plan.estimatedMinutes / 60 * 10) / 10,
    actualHours: 0,
    sessionId,
    projectKey,
    metadata: {
      priority: priority || 'medium',
      tags: tags || [],
      assignees: [],
      dependencies: [],
      blockers: [],
      autoExpand: autoExpand !== false,
      selfPlanning: selfPlanning !== false
    }
  };
  
  // 如果启用自动拆解
  if (task.metadata.autoExpand) {
    task.subtasks = TaskPlanner.autoExpandTask(task);
  }
  
  longRunningTasks.set(id, task);
  saveLongTasks();
  
  res.status(201).json(task);
});

// 获取所有长跑任务
app.get('/api/long-tasks', (req, res) => {
  const { status, sessionId, projectKey } = req.query;
  
  let tasks = Array.from(longRunningTasks.values());
  
  if (status) {
    const statuses = (status as string).split(',');
    tasks = tasks.filter(t => statuses.includes(t.status));
  }
  
  if (sessionId) {
    tasks = tasks.filter(t => t.sessionId === sessionId);
  }
  
  if (projectKey) {
    tasks = tasks.filter(t => t.projectKey === projectKey);
  }
  
  // 按状态和更新时间排序
  tasks.sort((a, b) => {
    const statusOrder = { running: 0, planning: 1, paused: 2, pending: 3, failed: 4, completed: 5 };
    const diff = (statusOrder[a.status] || 6) - (statusOrder[b.status] || 6);
    if (diff !== 0) return diff;
    return b.updatedAt - a.updatedAt;
  });
  
  res.json({ tasks, total: tasks.length });
});

// 获取单个长跑任务
app.get('/api/long-tasks/:id', (req, res) => {
  const task = longRunningTasks.get(req.params.id);
  if (!task) {
    return res.status(404).json({ error: 'Task not found' });
  }
  res.json(task);
});

// 更新任务状态
app.patch('/api/long-tasks/:id', (req, res) => {
  const task = longRunningTasks.get(req.params.id);
  if (!task) {
    return res.status(404).json({ error: 'Task not found' });
  }
  
  const { status, progress, title, description, priority, tags } = req.body;
  
  if (status) {
    task.status = status;
    if (status === 'running' && !task.startedAt) {
      task.startedAt = Date.now();
    }
    if (status === 'completed' && !task.completedAt) {
      task.completedAt = Date.now();
    }
  }
  
  if (progress !== undefined) {
    task.progress = progress;
  }
  
  if (title) task.title = title;
  if (description !== undefined) task.description = description;
  if (priority) task.metadata.priority = priority;
  if (tags) task.metadata.tags = tags;
  
  task.updatedAt = Date.now();
  task.progress = TaskPlanner.calculateProgress(task);
  
  saveLongTasks();
  broadcast({ type: 'longtask:updated', task });
  
  res.json(task);
});

// 启动任务
app.post('/api/long-tasks/:id/start', (req, res) => {
  const task = longRunningTasks.get(req.params.id);
  if (!task) {
    return res.status(404).json({ error: 'Task not found' });
  }
  
  task.status = 'running';
  task.startedAt = task.startedAt || Date.now();
  task.updatedAt = Date.now();
  
  // 启动第一个待处理的步骤
  const pendingStep = task.plan.steps.find(s => s.status === 'pending');
  if (pendingStep) {
    pendingStep.status = 'in_progress';
    pendingStep.startedAt = Date.now();
    task.plan.currentStep = task.plan.steps.indexOf(pendingStep);
  }
  
  task.progress = TaskPlanner.calculateProgress(task);
  saveLongTasks();
  broadcast({ type: 'longtask:started', task });
  
  res.json(task);
});

// 暂停任务
app.post('/api/long-tasks/:id/pause', (req, res) => {
  const task = longRunningTasks.get(req.params.id);
  if (!task) {
    return res.status(404).json({ error: 'Task not found' });
  }
  
  task.status = 'paused';
  task.updatedAt = Date.now();
  
  // 暂停当前步骤
  const inProgressStep = task.plan.steps.find(s => s.status === 'in_progress');
  if (inProgressStep && inProgressStep.startedAt) {
    inProgressStep.actualMinutes = (Date.now() - inProgressStep.startedAt) / 60000;
    inProgressStep.status = 'pending'; // 回到待处理，可以恢复
  }
  
  task.progress = TaskPlanner.calculateProgress(task);
  saveLongTasks();
  broadcast({ type: 'longtask:paused', task });
  
  res.json(task);
});

// 恢复任务
app.post('/api/long-tasks/:id/resume', (req, res) => {
  const task = longRunningTasks.get(req.params.id);
  if (!task) {
    return res.status(404).json({ error: 'Task not found' });
  }
  
  task.status = 'running';
  task.updatedAt = Date.now();
  
  // 恢复或开始下一个步骤
  const nextStep = task.plan.steps.find(s => s.status === 'pending');
  if (nextStep) {
    nextStep.status = 'in_progress';
    nextStep.startedAt = Date.now();
    task.plan.currentStep = task.plan.steps.indexOf(nextStep);
  }
  
  task.progress = TaskPlanner.calculateProgress(task);
  saveLongTasks();
  broadcast({ type: 'longtask:resumed', task });
  
  res.json(task);
});

// 完成步骤
app.post('/api/long-tasks/:id/complete-step', (req, res) => {
  const task = longRunningTasks.get(req.params.id);
  if (!task) {
    return res.status(404).json({ error: 'Task not found' });
  }
  
  const { stepId, result } = req.body;
  
  const step = task.plan.steps.find(s => s.id === stepId);
  if (!step) {
    return res.status(404).json({ error: 'Step not found' });
  }
  
  step.status = 'completed';
  step.completedAt = Date.now();
  if (step.startedAt) {
    step.actualMinutes = (step.completedAt - step.startedAt) / 60000;
  }
  step.result = result;
  
  // 计算实际花费时间
  task.plan.actualMinutes = task.plan.steps.reduce((sum, s) => sum + (s.actualMinutes || 0), 0);
  task.actualHours = Math.round(task.plan.actualMinutes / 60 * 100) / 100;
  
  // 启动下一个步骤
  const nextStep = task.plan.steps.find(s => s.status === 'pending');
  if (nextStep) {
    nextStep.status = 'in_progress';
    nextStep.startedAt = Date.now();
    task.plan.currentStep = task.plan.steps.indexOf(nextStep);
  } else {
    // 所有步骤完成，任务完成
    task.status = 'completed';
    task.completedAt = Date.now();
  }
  
  task.progress = TaskPlanner.calculateProgress(task);
  task.updatedAt = Date.now();
  
  saveLongTasks();
  broadcast({ type: 'longtask:step_completed', task, step });
  
  res.json(task);
});

// 创建检查点
app.post('/api/long-tasks/:id/checkpoint', (req, res) => {
  const task = longRunningTasks.get(req.params.id);
  if (!task) {
    return res.status(404).json({ error: 'Task not found' });
  }
  
  const { name, note } = req.body;
  
  const checkpoint: TaskCheckpoint = {
    id: `cp_${Date.now()}`,
    name: name || `检查点 ${task.checkpoints.length + 1}`,
    timestamp: Date.now(),
    progress: task.progress,
    state: { ...task },
    note
  };
  
  task.checkpoints.push(checkpoint);
  task.updatedAt = Date.now();
  
  saveLongTasks();
  broadcast({ type: 'longtask:checkpoint_created', task, checkpoint });
  
  res.json(checkpoint);
});

// 恢复到检查点
app.post('/api/long-tasks/:id/restore/:checkpointId', (req, res) => {
  const task = longRunningTasks.get(req.params.id);
  if (!task) {
    return res.status(404).json({ error: 'Task not found' });
  }
  
  const checkpoint = task.checkpoints.find(c => c.id === req.params.checkpointId);
  if (!checkpoint) {
    return res.status(404).json({ error: 'Checkpoint not found' });
  }
  
  // 恢复状态
  const restoredState = checkpoint.state;
  task.status = 'paused';
  task.progress = checkpoint.progress;
  task.updatedAt = Date.now();
  
  // 更新步骤状态
  for (let i = 0; i < task.plan.steps.length; i++) {
    const currentStepIndex = task.plan.steps.findIndex(s => s.status === 'in_progress');
    if (currentStepIndex >= 0 && currentStepIndex >= i) {
      task.plan.steps[currentStepIndex].status = 'pending';
    }
  }
  
  saveLongTasks();
  broadcast({ type: 'longtask:restored', task, checkpoint });
  
  res.json(task);
});

// 重新规划任务
app.post('/api/long-tasks/:id/replan', (req, res) => {
  const task = longRunningTasks.get(req.params.id);
  if (!task) {
    return res.status(404).json({ error: 'Task not found' });
  }
  
  // 保留已完成步骤的记录，重新生成后续步骤
  const completedSteps = task.plan.steps.filter(s => s.status === 'completed');
  const newPlan = TaskPlanner.analyzeAndPlan({ title: task.title, description: task.description });
  
  // 合并已完成和新计划
  const mergedSteps = [...completedSteps];
  for (const step of newPlan.steps) {
    if (!completedSteps.some(c => c.name === step.name)) {
      mergedSteps.push(step);
    }
  }
  
  task.plan = {
    steps: mergedSteps,
    currentStep: completedSteps.length,
    totalSteps: mergedSteps.length,
    estimatedMinutes: mergedSteps.reduce((sum, s) => sum + s.estimatedMinutes, 0),
    actualMinutes: task.plan.actualMinutes
  };
  
  task.updatedAt = Date.now();
  task.progress = TaskPlanner.calculateProgress(task);
  
  // 如果启用自动拆解，更新子任务
  if (task.metadata.autoExpand) {
    task.subtasks = TaskPlanner.autoExpandTask(task);
  }
  
  saveLongTasks();
  broadcast({ type: 'longtask:replanned', task });
  
  res.json(task);
});

// 添加子任务
app.post('/api/long-tasks/:id/subtasks', (req, res) => {
  const task = longRunningTasks.get(req.params.id);
  if (!task) {
    return res.status(404).json({ error: 'Task not found' });
  }
  
  const { title, priority, assignee, dependencies } = req.body;
  
  const subtask: SubTask = {
    id: `sub_${Date.now()}`,
    title,
    status: 'pending',
    progress: 0,
    priority: priority || task.metadata.priority,
    assignee,
    dependencies: dependencies || [],
    createdAt: Date.now()
  };
  
  task.subtasks.push(subtask);
  task.updatedAt = Date.now();
  
  saveLongTasks();
  broadcast({ type: 'longtask:subtask_added', task, subtask });
  
  res.json(subtask);
});

// 更新子任务状态
app.patch('/api/long-tasks/:id/subtasks/:subtaskId', (req, res) => {
  const task = longRunningTasks.get(req.params.id);
  if (!task) {
    return res.status(404).json({ error: 'Task not found' });
  }
  
  const subtask = task.subtasks.find(s => s.id === req.params.subtaskId);
  if (!subtask) {
    return res.status(404).json({ error: 'Subtask not found' });
  }
  
  const { status, progress, notes } = req.body;
  
  if (status) {
    subtask.status = status;
    if (status === 'completed' && !subtask.completedAt) {
      subtask.completedAt = Date.now();
    }
  }
  
  if (progress !== undefined) subtask.progress = progress;
  if (notes) subtask.notes = notes;
  
  task.progress = TaskPlanner.calculateProgress(task);
  task.updatedAt = Date.now();
  
  saveLongTasks();
  broadcast({ type: 'longtask:subtask_updated', task, subtask });
  
  res.json(subtask);
});

// 获取任务统计
app.get('/api/long-tasks/stats/summary', (req, res) => {
  const tasks = Array.from(longRunningTasks.values());
  
  const stats = {
    total: tasks.length,
    running: tasks.filter(t => t.status === 'running').length,
    paused: tasks.filter(t => t.status === 'paused').length,
    completed: tasks.filter(t => t.status === 'completed').length,
    planning: tasks.filter(t => t.status === 'planning').length,
    totalHours: tasks.reduce((sum, t) => sum + t.actualHours, 0),
    totalEstimatedHours: tasks.reduce((sum, t) => sum + t.estimatedHours, 0),
    avgProgress: tasks.length > 0 
      ? Math.round(tasks.reduce((sum, t) => sum + t.progress, 0) / tasks.length) 
      : 0
  };
  
  res.json(stats);
});

// 持久化
function saveLongTasks() {
  try {
    const data = Array.from(longRunningTasks.values());
    fs.writeFileSync(getCognitiveDataPath('longtasks.json'), JSON.stringify(data, null, 2));
  } catch (e) {
    console.error('Failed to save long tasks:', e);
  }
}

function loadLongTasks() {
  try {
    const filePath = getCognitiveDataPath('longtasks.json');
    if (fs.existsSync(filePath)) {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      for (const task of data) {
        longRunningTasks.set(task.id, task);
      }
    }
  } catch (e) {
    console.error('Failed to load long tasks:', e);
  }
}

// 初始化加载
loadLongTasks();

// ============== Session Health APIs ==============

app.get('/api/sessions/health', (req, res) => {
  const results: SessionHealth[] = [];
  for (const session of sessions) {
    const sessionTasks = tasks.filter(t => 
      t.sessionId === session.id || 
      t.projectKey === session.projectKey
    );
    results.push(calculateSessionHealth(session, sessionTasks));
  }
  res.json({ sessions: results });
});

app.get('/api/sessions/health/:sessionId', (req, res) => {
  const session = sessions.find(s => s.id === req.params.sessionId);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }
  const sessionTasks = tasks.filter(t => 
    t.sessionId === session.id || 
    t.projectKey === session.projectKey
  );
  const health = calculateSessionHealth(session, sessionTasks);
  res.json(health);
});

// ============== Session Summary APIs (3-sentence) ==============

app.get('/api/sessions/summary', (req, res) => {
  const summaries: Record<string, string> = {};
  for (const session of sessions) {
    const sessionTasks = tasks.filter(t => 
      t.sessionId === session.id || 
      t.projectKey === session.projectKey
    );
    const health = calculateSessionHealth(session, sessionTasks);
    summaries[session.id] = health.summary;
  }
  res.json({ summaries });
});

app.get('/api/sessions/summary/:sessionId', (req, res) => {
  const session = sessions.find(s => s.id === req.params.sessionId);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }
  const sessionTasks = tasks.filter(t => 
    t.sessionId === session.id || 
    t.projectKey === session.projectKey
  );
  const health = calculateSessionHealth(session, sessionTasks);
  res.json({ summary: health.summary, health });
});

// ============== Task Auto-Extraction APIs ==============

app.post('/api/tasks/parse', (req, res) => {
  const { text, sessionId, projectKey } = req.body;
  if (!text) {
    return res.status(400).json({ error: 'Text is required' });
  }
  
  const parsed = parseNaturalLanguageToTask(text);
  if (!parsed) {
    return res.status(400).json({ error: 'Could not parse text into task' });
  }
  
  // 查找关联的session
  let linkedSessionId = sessionId;
  let linkedProjectKey = projectKey;
  
  if (!linkedSessionId && projectKey) {
    const session = sessions.find(s => s.projectKey === projectKey);
    if (session) {
      linkedSessionId = session.id;
      linkedProjectKey = session.projectKey;
    }
  }
  
  // 创建任务
  const task = {
    id: uuidv4(),
    title: parsed.title,
    description: parsed.description || '',
    status: 'pending',
    priority: parsed.priority || 'medium',
    tags: parsed.tags || [],
    type: parsed.type,
    sessionId: linkedSessionId,
    projectKey: linkedProjectKey,
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
  
  tasks.push(task);
  
  // 如果有关联的session，更新session的tasks
  if (linkedSessionId) {
    const session = sessions.find(s => s.id === linkedSessionId);
    if (session) {
      if (!session.context) session.context = {};
      if (!session.context.tasks) session.context.tasks = [];
      session.context.tasks.push(task.id);
      saveData();
      broadcast({ type: 'task:created', task, session });
    }
  }
  
  res.status(201).json({ task, parsed });
});

app.post('/api/tasks/extract-from-message', (req, res) => {
  // 从OpenCode消息中自动提取任务
  const { messages, sessionId, projectKey } = req.body;
  
  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'Messages array is required' });
  }
  
  const extractedTasks: any[] = [];
  
  for (const msg of messages) {
    const content = typeof msg === 'string' ? msg : msg.content;
    if (!content) continue;
    
    // 检测任务创建意图
    const createPatterns = [
      /创建(?:一个)?(?:新的)?(?:功能|module|组件)?[:：]?\s*(.+)/i,
      /添加(?:一个)?(?:新的)?(?:功能)?[:：]?\s*(.+)/i,
      /实现(?:一个)?(?:新的)?(?:功能)?[:：]?\s*(.+)/i,
      /修复(?:一个)?(?:bug)?[:：]?\s*(.+)/i,
      /todo[:：]?\s*(.+)/i,
      /任务[:：]?\s*(.+)/i
    ];
    
    for (const pattern of createPatterns) {
      const match = content.match(pattern);
      if (match) {
        const parsed = parseNaturalLanguageToTask(match[0]);
        if (parsed) {
          const task = {
            id: uuidv4(),
            title: parsed.title,
            description: `从对话自动提取: ${content.substring(0, 200)}`,
            status: 'pending',
            priority: parsed.priority || 'medium',
            tags: ['auto-extracted', ...(parsed.tags || [])],
            type: parsed.type,
            sessionId,
            projectKey,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            autoExtracted: true
          };
          tasks.push(task);
          extractedTasks.push(task);
        }
        break;
      }
    }
    
    // 检测任务完成意图
    const completePatterns = [
      /(?:完成|搞定|结束了)(?:了)?(?::|：)?\s*(.+)/i,
      /(?:已经)?(?:完成|搞定)[:：]?\s*(.+)/i
    ];
    
    for (const pattern of completePatterns) {
      const match = content.match(pattern);
      if (match) {
        const titleToFind = match[1].trim();
        const taskToComplete = tasks.find(t => 
          (t.sessionId === sessionId || t.projectKey === projectKey) &&
          t.status !== 'completed' &&
          t.title.includes(titleToFind)
        );
        if (taskToComplete) {
          taskToComplete.status = 'completed';
          taskToComplete.completedAt = Date.now();
          taskToComplete.updatedAt = Date.now();
          extractedTasks.push({ ...taskToComplete, _action: 'completed' });
        }
        break;
      }
    }
  }
  
  res.json({ extracted: extractedTasks.length, tasks: extractedTasks });
});

// ============== View Mode APIs ==============

app.get('/api/sessions/views', (req, res) => {
  const { mode } = req.query;
  
  if (mode === 'health') {
    // 按健康度排序
    const withHealth = sessions.map(session => {
      const sessionTasks = tasks.filter(t => 
        t.sessionId === session.id || 
        t.projectKey === session.projectKey
      );
      return {
        ...session,
        health: calculateSessionHealth(session, sessionTasks)
      };
    }).sort((a, b) => a.health.health - b.health.health);
    
    return res.json({ sessions: withHealth, mode: 'health' });
  }
  
  if (mode === 'recent') {
    // 按最近活动时间排序
    const sorted = [...sessions].sort((a, b) => 
      new Date(b.lastHeartbeat).getTime() - new Date(a.lastHeartbeat).getTime()
    );
    return res.json({ sessions: sorted, mode: 'recent' });
  }
  
  if (mode === 'priority') {
    // 按优先级排序
    const withHealth = sessions.map(session => {
      const sessionTasks = tasks.filter(t => 
        t.sessionId === session.id || 
        t.projectKey === session.projectKey
      );
      return {
        ...session,
        health: calculateSessionHealth(session, sessionTasks)
      };
    }).sort((a, b) => {
      const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
      return priorityOrder[a.health.priority] - priorityOrder[b.health.priority];
    });
    
    return res.json({ sessions: withHealth, mode: 'priority' });
  }
  
  // 默认：按创建时间排序
  const sorted = [...sessions].sort((a, b) => 
    new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
  res.json({ sessions: sorted, mode: 'default' });
});

// ============== WebSocket ==============

const server = createServer(app);
let wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  const totalInput = sessions.reduce((sum, s) => sum + (s.tokenUsage?.inputTokens || 0), 0);
  const totalOutput = sessions.reduce((sum, s) => sum + (s.tokenUsage?.outputTokens || 0), 0);
  const totalTokens = sessions.reduce((sum, s) => sum + (s.tokenUsage?.totalTokens || 0), 0);
  
  ws.send(JSON.stringify({ 
    type: 'connected', 
    sessions,
    tasks,
    summary: {
      totalSessions: sessions.length,
      activeSessions: sessions.filter(s => s.status === 'active').length,
      totalTasks: tasks.length,
      activeTasks: tasks.filter(t => t.status === 'in_progress').length,
      completedTasks: tasks.filter(t => t.status === 'completed').length,
      tokenUsageSummary: {
        totalInputTokens: totalInput,
        totalOutputTokens: totalOutput,
        totalTokens: totalTokens,
        sessionCount: sessions.length,
        totalRatePerSecond: 0,
        totalRatePerMinute: 0
      }
    }
  }));

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      if (data.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong' }));
      }
    } catch (e) {}
  });
});

function broadcast(data) {
  const msg = JSON.stringify(data);
  wss?.clients?.forEach(client => {
    if (client.readyState === 1) client.send(msg);
  });
}

server.listen(PORT, () => {
  const now = Date.now();
  const before = sessions.length;
  sessions = sessions.filter(s => {
    const last = new Date(s.lastHeartbeat).getTime();
    return now - last < SESSION_TIMEOUT;
  });
  if (sessions.length !== before) {
    saveData();
    console.log(`🧹 已清理 ${before - sessions.length} 个过期会话`);
  }
  setInterval(() => {
    const now = Date.now();
    const before = sessions.length;
    sessions = sessions.filter(s => {
      const last = new Date(s.lastHeartbeat).getTime();
      return now - last < SESSION_TIMEOUT;
    });
    if (sessions.length !== before) {
      saveData();
      broadcast({ type: 'sessions:cleanup', removed: before - sessions.length });
      console.log(`🧹 已清理 ${before - sessions.length} 个过期会话`);
    }
  }, 60000);
  
  console.log(`🎯 OpenCode Task Hub 运行中!`);
  console.log(`   仪表板: http://localhost:${PORT}`);
  console.log(`   ${sessions.length} 个会话已注册`);
  console.log(`   /api/cognitive/* - 认知负荷优化 (Phase 1-5)\n`);
});
