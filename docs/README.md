# OpenCode Task Hub - Documentation

## 新增功能：三层负荷优化 (Phase 1-3)

基于"三层负荷叠加：AI时代为什么越用越累？"框架设计，显著降低用户认知负担。

### Phase 1: 进度连续性记忆
**目标：降低切换代价**

```javascript
// 保存用户当前位置
taskManager.saveUserPosition('user_001', {
  lastSessionId: 'session_xxx',
  lastTaskId: 'task_yyy',
  lastViewType: 'board'
});

// 获取上次位置
const position = taskManager.getUserPosition('user_001');

// 推荐下一个Session
const nextSession = taskManager.suggestNextSession('user_001');
```

### Phase 2: AI上下文摘要
**目标：突破上下文上限**

```javascript
// 获取单个Session的3句话摘要
const summary = await taskManager.getSessionSummary('session_xxx');
// { progress: "...", blocker: "...", nextAction: "..." }

// 批量获取摘要（用于Dashboard）
const summaries = await taskManager.getSessionSummaries();

// 获取Task简短摘要
const taskSummary = taskManager.getTaskSummary('task_yyy');
```

### Phase 3: 置信度指标
**目标：消除焦虑负荷**

```javascript
// 评估AI输出置信度
const result = taskManager.evaluateConfidence({
  sessionId: 'session_xxx',
  outputType: 'code',
  outputContent: '...'
});
// { score: 0.85, level: 'medium', action: 'notify', summary: '...' }

// 检查是否需要确认
const needsConfirm = taskManager.needsConfirmation({
  outputType: 'delete',
  outputContent: '...'
});

// 记录变更历史
taskManager.recordChange({
  actionType: 'update',
  targetType: 'task',
  targetId: 'task_xxx',
  targetName: 'Fix bug #123',
  confidence: 0.92
});
```

### 置信度等级

| 等级 | 分数 | 动作 | 颜色 |
|------|------|------|------|
| 🟢 高 | 95%+ | 自动执行 | `#22c55e` |
| 🟡 中 | 70-95% | 通知用户 | `#eab308` |
| 🔴 低 | <70% | 等待确认 | `#ef4444` |

---

## Dashboard Screenshots

This directory contains screenshots for the OpenCode Task Hub project.

## Required Screenshots

Please capture and save the following screenshots:

1. **screenshot.png** - Main dashboard showing:
   - Session list with active sessions
   - Task list with sample tasks
   - Summary statistics

## How to Capture

1. Start the server: `npm start`
2. Open http://localhost:3030 in your browser
3. Capture a screenshot of the full dashboard
4. Save as `screenshot.png` in this directory

## Recommended Tools

- macOS: Cmd+Shift+4 (Selection) or Cmd+Shift+3 (Full screen)
- Windows: Win+Shift+S (Snip & Sketch)
- Linux: gnome-screenshot or Flameshot

## Guidelines

- Include the full dashboard view
- Show at least one active session (if available)
- Show the task list section
- Dark theme is recommended (matches the default dashboard)
