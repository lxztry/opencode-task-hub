# Task Auto-Track Plugin for OpenCode

## 功能

当 OpenCode Agent 完成任务时，自动将任务状态同步到 OpenCode Task Hub。

## 安装

1. 复制 `plugins/task-autotrack.js` 到你的 OpenCode 插件目录

2. 在 OpenCode 配置中启用：

```json
{
  "plugins": {
    "task-autotrack": {
      "enabled": true,
      "taskHubUrl": "http://localhost:3030"
    }
  }
}
```

## 工作原理

插件会监听 OpenCode Agent 的输出，识别以下模式：

### 自动创建任务
- 检测到 "task: xxx" 或 "todo: xxx" 时自动创建任务
- 检测到 "creating xxx" 或 "implementing xxx" 时创建任务

### 自动完成任务
- 检测到 "completed: xxx" 或 "done: xxx" 时自动标记完成
- 检测到 "pushed to github" 时自动标记相关任务完成

## API 交互

插件会调用 Task Hub 的 REST API：

```javascript
// 注册会话
POST /api/sessions/register
{ sessionId, projectPath, projectName, hostname }

// 创建任务  
POST /api/tasks
{ title, status: 'in-progress', sessionId }

// 更新任务状态
PUT /api/tasks/:id
{ status: 'completed' }

// 发送心跳
POST /api/sessions/:sessionId/log
{ description }
```

## 调试

开启调试模式：

```javascript
const tracker = new TaskAutoTracker({
    taskHubUrl: 'http://localhost:3030',
    sessionId: 'debug-session',
    enabled: true,
    debug: true
});
```
