import { tool } from "@opencode-ai/plugin";
import os from "os";

const API_BASE = "http://localhost:3030";
const HEARTBEAT_INTERVAL = 30000;

const sessions = new Map();

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

function getTextFromParts(parts) {
  if (!parts || !Array.isArray(parts)) return "";
  return parts
    .filter((p) => p && p.type === "text")
    .map((p) => p.text)
    .join("\n");
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
    pid: process.pid
  });
}

async function heartbeat(sessionId, projectKey) {
  await api(`/api/sessions/${sessionId}/heartbeat`, "POST", { projectKey, pid: process.pid });
}

async function logActivity(sessionId, projectKey, description) {
  await api(`/api/sessions/${sessionId}/log`, "POST", { projectKey, description });
}

async function reportTokenUsage(sessionId, projectKey, inputTokens, outputTokens, model, conversationCount) {
  return await api(`/api/sessions/${sessionId}/token-usage`, "POST", {
    projectKey,
    inputTokens,
    outputTokens,
    model,
    conversationCount
  });
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

  return {
    tool: {
      registerTask: tool({
        description: "注册当前会话到任务中心",
        args: {},
        async execute(args, { sessionID, directory: dir }) {
          const sessionInfo = await ensureSession(sessionID, dir);
          return { registered: !!sessionInfo, sessionId: sessionInfo?.sessionId };
        },
      }),
      updateTaskActivity: tool({
        description: "更新当前会话的活动状态",
        args: {
          description: tool.schema.string().describe("活动描述"),
        },
        async execute(args, { sessionID }) {
          const sessionInfo = [...sessions.values()].find((s) => s.sessionId === sessionID);
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
        async execute(args, { sessionID, directory: dir }) {
          const sessionInfo = await ensureSession(sessionID, dir);
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
        async execute(args, { sessionID, directory: dir }) {
          const sessionInfo = await ensureSession(sessionID, dir);
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
        async execute(args, { sessionID, directory: dir }) {
          const sessionInfo = await ensureSession(sessionID, dir);
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
      reportTokenUsage: tool({
        description: "上报token消耗统计",
        args: {
          inputTokens: tool.schema.number().describe("输入token数量"),
          outputTokens: tool.schema.number().describe("输出token数量"),
          model: tool.schema.string().optional().describe("使用的模型名称"),
        },
        async execute(args, { sessionID, directory: dir }) {
          const sessionInfo = await ensureSession(sessionID, dir);
          if (!sessionInfo) return { success: false };
          try {
            await reportTokenUsage(
              sessionInfo.sessionId,
              sessionInfo.projectKey,
              args.inputTokens || 0,
              args.outputTokens || 0,
              args.model,
              1
            );
            return { success: true };
          } catch (e) {
            return { success: false };
          }
        },
      }),
    },
    "tool.execute.after": async (input, output) => {
      const sessionInfo = await ensureSession(input.sessionID, directory);
      if (sessionInfo) {
        let desc = `执行 ${input.tool}`;
        if (input.args?.filePath) desc += `: ${input.args.filePath}`;
        else if (input.args?.command) desc += `: ${input.args.command}`;
        await logActivity(sessionInfo.sessionId, sessionInfo.projectKey, desc);
      }
    },
    "chat.message": async (input, output) => {
      const userText = getTextFromParts(output?.parts);
      if (userText && userText.length >= 5) {
        const taskTitle = extractTaskFromMessage(userText);
        const sessionInfo = await ensureSession(input.sessionID, directory);

        if (sessionInfo && taskTitle) {
          const now = Date.now();
          if (now - (sessionInfo.lastTaskTime || 0) > 30000) {
            await createTask(sessionInfo.id, taskTitle, "medium", sessionInfo.projectKey);
            sessionInfo.lastTaskTime = now;
            console.log(`[TaskHub] 自动提取任务: ${taskTitle}`);
          }
        }
      }

      if (input.agent) {
        const sessionInfo = await ensureSession(input.sessionID, directory);
        if (sessionInfo) {
          await logActivity(sessionInfo.sessionId, sessionInfo.projectKey, `AI: ${input.agent}`);
        }
      }

      const usage = output?.usage;
      if (usage && (usage.inputTokens || usage.outputTokens || usage.completionTokens)) {
        const sessionInfo = await ensureSession(input.sessionID, directory);
        if (sessionInfo) {
          await reportTokenUsage(
            sessionInfo.sessionId,
            sessionInfo.projectKey,
            usage.inputTokens || 0,
            usage.outputTokens || usage.completionTokens || 0,
            usage.model,
            1
          );
        }
      }
    },
  };
};

export default TaskReporterPlugin;
