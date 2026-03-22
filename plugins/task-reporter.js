import { tool } from "@opencode-ai/plugin";
import os from "os";

const API_BASE = "http://localhost:3030";
const HEARTBEAT_INTERVAL = 30000;

const sessions = new Map();
const taskPatterns = [
  /^(帮我|请|我想|需要|要|能不能)/i,
  /^(实现|开发|添加|创建|修复|优化|改进|完善|重构|检查|分析)/i,
  /^任务[:：]/i,
  /^.task/i,
];

function extractTaskFromMessage(message) {
  if (!message || typeof message !== "string") return null;
  message = message.trim();
  if (message.length < 4) return null;

  const extractors = [
    (msg) => {
      const m = msg.match(/^请\s*帮我\s+(.+)/i);
      if (m && m[1]) return m[1].trim();
      return null;
    },
    (msg) => {
      const m = msg.match(/^能不能\s*帮我\s+(.+)/i);
      if (m && m[1]) return m[1].trim();
      return null;
    },
    (msg) => {
      const m = msg.match(/^(帮我|请|我想|需要|要|能不能)\s*(.+)/i);
      if (m && m[2]) return m[2].trim();
      return null;
    },
    (msg) => {
      const m = msg.match(/^(实现|开发|添加|创建|修复|优化|改进|完善|重构|检查|分析)\s*(?:一个\s*)?(.+)/i);
      if (m && m[0]) return m[0].trim();
      return null;
    },
    (msg) => {
      const m = msg.match(/^任务[:：]\s*(.+)/i);
      if (m && m[1]) return m[1].trim();
      return null;
    },
    (msg) => {
      const m = msg.match(/^\.task\s+(.+)/i);
      if (m && m[1]) return m[1].trim();
      return null;
    },
  ];

  for (const extractor of extractors) {
    const title = extractor(message);
    if (title && title.length >= 3 && title.length <= 150) {
      return title;
    }
  }

  return null;
}

async function api(endpoint, method = "GET", body = null) {
  try {
    const options = {
      method,
      headers: { "Content-Type": "application/json" },
    };
    if (body) options.body = JSON.stringify(body);
    const resp = await fetch(`${API_BASE}${endpoint}`, options);
    return await resp.json();
  } catch (e) {
    return null;
  }
}

async function registerSession(sessionId, projectPath, projectName) {
  return await api("/api/sessions/register", "POST", {
    sessionId,
    projectPath,
    projectName,
    hostname: os.hostname(),
  });
}

async function heartbeat(sessionId, projectKey) {
  await api(`/api/sessions/${sessionId}/heartbeat`, "POST", { projectKey });
}

async function logActivity(sessionId, projectKey, description) {
  await api(`/api/sessions/${sessionId}/log`, "POST", { projectKey, description });
}

async function createTask(sessionId, title, priority = "medium", projectKey = null) {
  return await api("/api/tasks", "POST", {
    title,
    status: "pending",
    priority,
    sessionId,
    createdBy: "user",
    projectKey,
  });
}

async function ensureSession(sessionID, cwd) {
  const projectPath = cwd || directory || process.cwd();
  const projectKey = `${os.hostname()}:${projectPath}`;
  let sessionInfo = sessions.get(projectKey);
  if (!sessionInfo) {
    const projectName = project?.name || projectPath.split(/[/\\]/).pop() || "unknown";
    const session = await registerSession(sessionID, projectPath, projectName);
    if (session?.id) {
      const heartbeatTimer = setInterval(async () => {
        const si = sessions.get(projectKey);
        if (si) {
          await heartbeat(si.sessionId, projectKey);
        }
      }, HEARTBEAT_INTERVAL);
      sessionInfo = { id: session.id, sessionId: sessionID, heartbeatTimer, projectName, projectPath, projectKey };
      sessions.set(projectKey, sessionInfo);
    }
  } else {
    sessionInfo.sessionId = sessionID;
  }
  return sessionInfo;
}

export const TaskReporterPlugin = async ({
  client,
  project,
  directory,
  serverUrl,
}) => {
  return {
    tool: {
      registerTask: tool({
        description: "注册当前会话到任务中心",
        args: {},
        async execute(args, { sessionID, cwd }) {
          const sessionInfo = await ensureSession(sessionID, cwd);
          return { registered: !!sessionInfo, sessionId: sessionInfo?.sessionId };
        },
      }),
      updateTaskActivity: tool({
        description: "更新当前会话的活动状态",
        args: {
          description: tool.schema.string().describe("活动描述"),
        },
        async execute(args, { sessionID }) {
          const sessionInfo = await ensureSession(sessionID, args.cwd);
          if (sessionInfo) {
            await logActivity(sessionInfo.sessionId, sessionInfo.projectKey, args.description);
          }
          return { logged: !!sessionInfo };
        },
      }),
      addTask: tool({
        description: "添加任务到任务中心（推荐使用）",
        args: {
          title: tool.schema.string().describe("任务标题，简洁明确"),
          priority: tool.schema.enum(["high", "medium", "low"]).optional().describe("优先级：high/medium/low"),
        },
        async execute(args, { sessionID, cwd }) {
          const sessionInfo = await ensureSession(sessionID, cwd);
          if (!sessionInfo) return { success: false, error: "无法连接到任务中心" };
          
          const task = await createTask(sessionInfo.id, args.title, args.priority || "medium", sessionInfo.projectKey);
          if (task?.id) {
            await logActivity(sessionInfo.sessionId, sessionInfo.projectKey, `📋 添加任务: ${args.title}`);
            return { success: true, task };
          }
          return { success: false, error: "创建任务失败" };
        },
      }),
      listTasks: tool({
        description: "查看当前会话的所有任务",
        args: {},
        async execute(args, { sessionID, cwd }) {
          const sessionInfo = await ensureSession(sessionID, cwd);
          if (!sessionInfo) {
            return { success: false, tasks: [], message: "请先使用 registerTask 注册会话" };
          }
          try {
            const resp = await fetch(`${API_BASE}/api/tasks?sessionId=${encodeURIComponent(sessionInfo.projectKey)}`);
            const data = await resp.json();
            return { success: true, tasks: data.tasks || [] };
          } catch (e) {
            return { success: false, tasks: [], error: "获取任务失败" };
          }
        },
      }),
      completeTask: tool({
        description: "标记任务为已完成",
        args: {
          taskId: tool.schema.string().describe("任务ID"),
        },
        async execute(args, { sessionID, cwd }) {
          const sessionInfo = await ensureSession(sessionID, cwd);
          if (!sessionInfo) return { success: false };
          try {
            const resp = await fetch(`${API_BASE}/api/tasks/${args.taskId}`, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ status: "completed" })
            });
            const task = await resp.json();
            if (task.id) {
              await logActivity(sessionInfo.sessionId, sessionInfo.projectKey, `✅ 完成任务: ${task.title}`);
            }
            return { success: true, task };
          } catch (e) {
            return { success: false };
          }
        },
      }),
    },
    "tool.execute.after": async (input, output) => {
      const sessionInfo = await ensureSession(input.sessionID, input.cwd);
      if (sessionInfo) {
        let desc = `执行 ${input.tool}`;
        if (input.args?.filePath) desc += `: ${input.args.filePath}`;
        else if (input.args?.command) desc += `: ${input.args.command}`;
        await logActivity(sessionInfo.sessionId, sessionInfo.projectKey, desc);
      }
    },
    "chat.user.message": async (input) => {
      const userMessage = typeof input.message === "string" ? input.message : (input.messages?.slice(-1)[0]?.content || "");
      if (!userMessage || userMessage.length < 5) return;

      const taskTitle = extractTaskFromMessage(userMessage);
      const sessionInfo = await ensureSession(input.sessionID, input.cwd || directory);

      if (sessionInfo && taskTitle) {
        const now = Date.now();
        if (now - (sessionInfo.lastTaskTime || 0) > 30000) {
          await createTask(sessionInfo.id, taskTitle, "medium", sessionInfo.projectKey);
          sessionInfo.lastTaskTime = now;
          console.log(`[TaskHub] 自动提取任务: ${taskTitle}`);
        }
      }
    },
    "chat.message": async (input, output) => {
      const sessionInfo = await ensureSession(input.sessionID, input.cwd || directory);
      if (sessionInfo && input.agent) {
        await logActivity(sessionInfo.sessionId, sessionInfo.projectKey, `AI: ${input.agent}`);
      }
    },
  };
};

export default TaskReporterPlugin;
