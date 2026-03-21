import { tool } from "@opencode-ai/plugin";

const API_BASE = "http://localhost:3030";
const HEARTBEAT_INTERVAL = 30000;

const progressTracker = new Map();

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

async function updateProgress(taskId, progress, description) {
  return await api(`/api/tasks/${taskId}`, "PUT", {
    progress,
    activity: description,
  });
}

export const ProgressTrackerPlugin = async ({
  client,
  project,
  directory,
  serverUrl,
}) => {
  return {
    tool: {
      trackProgress: tool({
        description: "追踪代码编写进度到任务中心",
        args: {
          taskId: tool.schema.string().describe("任务ID"),
          progress: tool.schema.number().min(0).max(100).describe("进度百分比 (0-100)"),
          description: tool.schema.string().describe("当前进度的描述"),
        },
        async execute(args) {
          const { taskId, progress, description } = args;
          const result = await updateProgress(taskId, progress, description);
          return {
            success: !!result,
            taskId,
            progress,
            message: `进度已更新: ${progress}% - ${description}`,
          };
        },
      }),
      startSprint: tool({
        description: "创建一个冲刺任务并开始追踪",
        args: {
          title: tool.schema.string().describe("冲刺标题"),
          duration: tool.schema.number().describe("预计时长（小时）"),
        },
        async execute(args, { sessionID }) {
          const task = await api("/api/tasks", "POST", {
            title: `冲刺: ${args.title}`,
            status: "in_progress",
            priority: "high",
            sessionId: sessionID,
            sprint: {
              duration: args.duration,
              startedAt: new Date().toISOString(),
            },
          });
          if (task?.id) {
            const interval = setInterval(async () => {
              const current = progressTracker.get(sessionID) || { count: 0, taskId: task.id };
              current.count++;
              const estimatedProgress = Math.min(95, (current.count / (args.duration * 4)) * 100);
              await updateProgress(task.id, Math.round(estimatedProgress), `更新 ${current.count}`);
            }, 15 * 60 * 1000);
            progressTracker.set(sessionID, { interval, taskId: task.id, count: 0 });
          }
          return { sprintCreated: !!task?.id, taskId: task?.id };
        },
      }),
      endSprint: tool({
        description: "结束当前冲刺并标记为完成",
        args: {},
        async execute(args, { sessionID }) {
          const tracker = progressTracker.get(sessionID);
          if (tracker) {
            clearInterval(tracker.interval);
            await updateProgress(tracker.taskId, 100, "冲刺完成!");
            progressTracker.delete(sessionID);
          }
          return { sprintEnded: true };
        },
      }),
    },
    "tool.execute.after": async (input, output) => {
      const sessionProgress = progressTracker.get(input.sessionID);
      if (sessionProgress) {
        sessionProgress.count++;
      }
    },
  };
};

export default ProgressTrackerPlugin;
