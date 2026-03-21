import { tool } from "@opencode-ai/plugin";
import os from "os";

const API_BASE = "http://localhost:3030";
const HEARTBEAT_INTERVAL = 30000;

const sessions = new Map();

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
