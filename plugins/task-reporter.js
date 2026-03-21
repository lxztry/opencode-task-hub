import { tool } from "@opencode-ai/plugin";
import os from "os";

const API_BASE = "http://localhost:3030";
const HEARTBEAT_INTERVAL = 30000;

const sessions = new Map();
const taskPatterns = [
  /^帮我/i,
  /^请/i,
  /^我想/i,
  /^需要/i,
  /^要/i,
  /^能不能/i,
  /^(实现|开发|添加|创建|修复|优化|改进|完善)/i,
  /^任务/i,
  /^.task/i,
];

function extractTaskFromMessage(message) {
  if (!message || typeof message !== "string") return null;
  message = message.trim();
  if (message.length < 5 || message.length > 500) return null;
  const isTaskLike = taskPatterns.some((pattern) => pattern.test(message));
  if (!isTaskLike) return null;
  return message.slice(0, 200);
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

async function heartbeat(sessionId) {
  await api(`/api/sessions/${sessionId}/heartbeat`, "POST");
}

async function logActivity(sessionId, description) {
  await api(`/api/sessions/${sessionId}/log`, "POST", { description });
}

async function createTask(sessionId, title, priority = "medium") {
  return await api("/api/tasks", "POST", {
    title,
    status: "pending",
    priority,
    sessionId,
    createdBy: "user",
  });
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
          const projectPath = cwd || directory || process.cwd();
          const projectName = project?.name || projectPath.split(/[/\\]/).pop() || "unknown";

          if (sessions.has(sessionID)) {
            return { registered: true, sessionId: sessionID };
          }

          const session = await registerSession(sessionID, projectPath, projectName);
          if (session?.sessionId) {
            const heartbeatTimer = setInterval(() => heartbeat(session.sessionId), HEARTBEAT_INTERVAL);
            sessions.set(sessionID, {
              sessionId: session.sessionId,
              heartbeatTimer,
              projectName,
              projectPath,
            });
          }
          return { registered: !!session?.sessionId, sessionId: session?.sessionId };
        },
      }),
      updateTaskActivity: tool({
        description: "更新当前会话的活动状态",
        args: {
          description: tool.schema.string().describe("活动描述"),
        },
        async execute(args, { sessionID }) {
          const sessionInfo = sessions.get(sessionID);
          if (sessionInfo) {
            await logActivity(sessionInfo.sessionId, args.description);
          }
          return { logged: !!sessionInfo };
        },
      }),
    },
    "tool.execute.after": async (input, output) => {
      let sessionInfo = sessions.get(input.sessionID);

      if (!sessionInfo) {
        const projectPath = directory || process.cwd();
        const projectName = project?.name || projectPath.split(/[/\\]/).pop() || "unknown";
        const session = await registerSession(input.sessionID, projectPath, projectName);

        if (session?.sessionId) {
          const heartbeatTimer = setInterval(() => heartbeat(session.sessionId), HEARTBEAT_INTERVAL);
          sessionInfo = {
            sessionId: session.sessionId,
            heartbeatTimer,
            projectName,
            projectPath,
          };
          sessions.set(input.sessionID, sessionInfo);
        }
      }

      if (sessionInfo) {
        const toolName = input.tool;
        let desc = `执行 ${toolName}`;
        if (input.args?.filePath) {
          desc += `: ${input.args.filePath}`;
        } else if (input.args?.command) {
          desc += `: ${input.args.command}`;
        }
        await logActivity(sessionInfo.sessionId, desc);
      }
    },
    "chat.user.message": async (input) => {
      const message = input.messages?.[input.messages?.length - 1]?.content;
      if (!message) return;

      const userMessage = Array.isArray(input.messages)
        ? input.messages.filter((m) => m.role === "user").map((m) => m.content).join("\n")
        : (input.messages?.content || "");

      const taskTitle = extractTaskFromMessage(userMessage);
      let sessionInfo = sessions.get(input.sessionID);

      if (!sessionInfo) {
        const projectPath = directory || process.cwd();
        const projectName = project?.name || projectPath.split(/[/\\]/).pop() || "unknown";
        const session = await registerSession(input.sessionID, projectPath, projectName);

        if (session?.sessionId) {
          const heartbeatTimer = setInterval(() => heartbeat(session.sessionId), HEARTBEAT_INTERVAL);
          sessionInfo = {
            sessionId: session.sessionId,
            heartbeatTimer,
            projectName,
            projectPath,
            lastTaskTime: 0,
          };
          sessions.set(input.sessionID, sessionInfo);
        }
      }

      if (sessionInfo && taskTitle) {
        const now = Date.now();
        if (now - (sessionInfo.lastTaskTime || 0) > 30000) {
          await createTask(sessionInfo.sessionId, taskTitle);
          sessionInfo.lastTaskTime = now;
          sessions.set(input.sessionID, sessionInfo);
        }
      }
    },
    "chat.message": async (input, output) => {
      let sessionInfo = sessions.get(input.sessionID);

      if (!sessionInfo) {
        const projectPath = directory || process.cwd();
        const projectName = project?.name || projectPath.split(/[/\\]/).pop() || "unknown";
        const session = await registerSession(input.sessionID, projectPath, projectName);

        if (session?.sessionId) {
          const heartbeatTimer = setInterval(() => heartbeat(session.sessionId), HEARTBEAT_INTERVAL);
          sessionInfo = {
            sessionId: session.sessionId,
            heartbeatTimer,
            projectName,
            projectPath,
          };
          sessions.set(input.sessionID, sessionInfo);
        }
      }

      if (sessionInfo && input.agent) {
        await logActivity(sessionInfo.sessionId, `AI: ${input.agent}`);
      }
    },
  };
};

export default TaskReporterPlugin;
