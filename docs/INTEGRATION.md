# OpenCode Task Hub - 插件集成指南

## 🎯 自动任务追踪

### 1. 安装插件

把 `plugins/task-autotrack.js` 复制到你的 OpenCode 项目：

```bash
cp plugins/task-autotrack.js /path/to/opencode/plugins/
```

### 2. 在 OpenCode 中加载插件

编辑 OpenCode 的配置文件 `opencode.json`：

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

### 3. 启动 Task Hub

```bash
cd opencode-task-hub
npm start
```

### 4. 启动 OpenCode

OpenCode 会自动：
- 注册会话到 Task Hub
- 追踪任务创建
- 自动标记完成

---

## 🔄 自动追踪流程

```
OpenCode Agent
    │
    ├─→ "Creating login feature"
    │       ↓
    │   [自动创建任务]
    │       ↓
    │   Task: "login feature" (in-progress)
    │
    ├─→ "Completed login feature"
    │       ↓
    │   [自动标记完成]
    │       ↓
    │   Task: "login feature" (done)
    │
    └─→ Dashboard 实时更新
```

---

## 📝 支持的关键词

### 任务创建
```
- task: "xxx"
- todo: "xxx"
- doing: "xxx"
- 开始实现 xxx
- creating xxx
```

### 任务完成
```
- completed: "xxx"
- finished: "xxx"
- done: "xxx"
- 完成 xxx
- 已完成 xxx
```

---

## 🔧 配置选项

```javascript
const tracker = new TaskAutoTracker({
    taskHubUrl: 'http://localhost:3030',  // Task Hub 地址
    sessionId: 'my-session-001',          // 会话 ID
    enabled: true                         // 是否启用
});
```

---

## 📡 API 端点

### 会话管理
```
POST /api/sessions/register     - 注册会话
POST /api/sessions/:id/heartbeat - 发送心跳
POST /api/sessions/:id/log      - 发送活动日志
```

### 任务管理
```
GET  /api/tasks              - 获取所有任务
POST /api/tasks              - 创建任务
PUT  /api/tasks/:id          - 更新任务
```

### 增强 API
```
GET  /api/enhanced/sessions  - 获取会话树
POST /api/enhanced/sessions  - 创建会话
GET  /api/ai/risks           - 获取风险预警
```

---

## 🚀 高级用法

### 手动创建任务

```javascript
const tracker = require('./plugins/task-autotrack');
const t = tracker.createTracker();

await t.trackTask("实现用户登录功能");
```

### 手动完成任务

```javascript
await t.markTaskComplete("实现用户登录功能");
```

### 发送自定义日志

```javascript
t.onAgentOutput("正在编写 auth.js 文件");
```

---

## 📊 Dashboard 查看

启动后访问：`http://localhost:3030`

- 查看所有活跃会话
- 实时任务进度
- Token 使用统计
- Sprint 燃尽图
