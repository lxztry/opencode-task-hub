import { tool } from "@opencode-ai/plugin";
import os from "os";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOG_DIR = path.join(__dirname, "../logs");
const METRICS_FILE = path.join(LOG_DIR, "metrics.json");

const metrics = {
  commands: {},
  tools: {},
  files: {},
  sessions: {},
  daily: {},
};

function ensureLogDir() {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}

function loadMetrics() {
  try {
    if (fs.existsSync(METRICS_FILE)) {
      const data = fs.readFileSync(METRICS_FILE, "utf-8");
      return JSON.parse(data);
    }
  } catch (e) {
  }
  return metrics;
}

function saveMetrics(data) {
  ensureLogDir();
  fs.writeFileSync(METRICS_FILE, JSON.stringify(data, null, 2));
}

function updateMetrics(sessionId, type, key, value = 1) {
  const data = loadMetrics();
  const today = new Date().toISOString().split("T")[0];
  
  if (!data.daily[today]) {
    data.daily[today] = { commands: 0, tools: 0, files: 0 };
  }
  
  if (type === "command") {
    const cmd = key.split(" ")[0];
    data.commands[cmd] = (data.commands[cmd] || 0) + value;
    data.daily[today].commands += value;
  } else if (type === "tool") {
    data.tools[key] = (data.tools[key] || 0) + value;
    data.daily[today].tools += value;
  } else if (type === "file") {
    data.files[key] = (data.files[key] || 0) + value;
    data.daily[today].files += value;
  }
  
  if (!data.sessions[sessionId]) {
    data.sessions[sessionId] = { commands: 0, tools: 0, files: 0, createdAt: new Date().toISOString() };
  }
  data.sessions[sessionId][type === "command" ? "commands" : type === "tool" ? "tools" : "files"] += value;
  
  saveMetrics(data);
}

function getStats() {
  const data = loadMetrics();
  const today = new Date().toISOString().split("T")[0];
  
  const topCommands = Object.entries(data.commands)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  
  const topTools = Object.entries(data.tools)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  
  return {
    total: {
      commands: Object.values(data.commands).reduce((a, b) => a + b, 0),
      tools: Object.values(data.tools).reduce((a, b) => a + b, 0),
      files: Object.values(data.files).reduce((a, b) => a + b, 0),
      sessions: Object.keys(data.sessions).length,
    },
    today: data.daily[today] || { commands: 0, tools: 0, files: 0 },
    topCommands,
    topTools,
  };
}

export const MetricsCollectorPlugin = async ({
  client,
  project,
  directory,
  serverUrl,
}) => {
  return {
    tool: {
      getStats: tool({
        description: "获取当前项目/会话的使用统计",
        args: {},
        async execute() {
          const stats = getStats();
          return {
            stats,
            message: `总命令: ${stats.total.commands}, 总工具: ${stats.total.tools}, 总会话: ${stats.total.sessions}`,
          };
        },
      }),
    },
    "tool.execute.after": async (input, output) => {
      const sessionId = input.sessionID;
      updateMetrics(sessionId, "tool", input.tool);
      
      if (input.args?.command) {
        updateMetrics(sessionId, "command", input.args.command);
      }
      if (input.args?.filePath) {
        updateMetrics(sessionId, "file", path.basename(input.args.filePath));
      }
    },
  };
};

export default MetricsCollectorPlugin;
