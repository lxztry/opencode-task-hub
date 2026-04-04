/**
 * OpenCode Task Hub - Auto Task Tracker Plugin
 * 自动任务识别：当 Agent 完成任务时自动更新 Task Hub
 */

const http = require('http');

class TaskAutoTracker {
    constructor(config = {}) {
        this.taskHubUrl = config.taskHubUrl || 'http://localhost:3030';
        this.sessionId = config.sessionId || process.env.OPENCODE_SESSION_ID || 'default';
        this.enabled = config.enabled !== false;
        
        // 任务完成关键词
        this.completionKeywords = [
            'done', 'completed', 'finished', '完成', '已结束',
            'task completed', 'all done', '任务完成',
            'pushed to', '已推送', 'committed',
            'deployed', '已部署'
        ];
        
        // 任务创建关键词
        this.creationKeywords = [
            'creating', 'implementing', 'building', '开始实现',
            'creating file', 'writing to', '创建文件',
            'implementing', 'adding feature', '添加功能'
        ];
        
        // 任务创建模式
        this.taskCreationPatterns = [
            /task[:\s]+["'](.+?)["']/i,
            /任务[:\s]+["'](.+?)["']/i,
            /todo[:\s]+["'](.+?)["']/i,
            /doing[:\s]+["'](.+?)["']/i,
            /starting[:\s]+["'](.+?)["']/i
        ];
        
        // 任务完成模式
        this.taskCompletionPatterns = [
            /completed[:\s]+["'](.+?)["']/i,
            /finished[:\s]+["'](.+?)["']/i,
            /done[:\s]+["'](.+?)["']/i,
            /完成[:\s]+["'](.+?)["']/i
        ];
        
        // 当前追踪的任务
        this.trackedTasks = new Map();
        
        if (this.enabled) {
            this.registerSession();
        }
    }
    
    // 注册当前会话
    async registerSession() {
        try {
            const data = JSON.stringify({
                sessionId: this.sessionId,
                projectPath: process.cwd(),
                projectName: this.getProjectName(),
                hostname: require('os').hostname()
            });
            
            await this.post('/api/sessions/register', data);
            console.log(`[TaskAutoTracker] Session registered: ${this.sessionId}`);
        } catch (err) {
            console.warn('[TaskAutoTracker] Failed to register session:', err.message);
        }
    }
    
    getProjectName() {
        try {
            const path = require('path');
            return path.basename(process.cwd());
        } catch {
            return 'unknown';
        }
    }
    
    // 处理 Agent 输出，识别任务创建
    onAgentOutput(output, context = {}) {
        if (!this.enabled) return;
        
        // 检测任务创建
        const createdTask = this.detectTaskCreation(output);
        if (createdTask) {
            this.trackTask(createdTask, 'in-progress');
        }
        
        // 检测任务完成
        const completedTask = this.detectTaskCompletion(output);
        if (completedTask) {
            this.markTaskComplete(completedTask);
        }
        
        // 发送心跳
        this.sendHeartbeat(output.substring(0, 200));
    }
    
    // 检测任务创建
    detectTaskCreation(output) {
        for (const pattern of this.taskCreationPatterns) {
            const match = output.match(pattern);
            if (match) {
                return match[1];
            }
        }
        return null;
    }
    
    // 检测任务完成
    detectTaskCompletion(output) {
        for (const pattern of this.taskCompletionPatterns) {
            const match = output.match(pattern);
            if (match) {
                return match[1];
            }
        }
        return null;
    }
    
    // 追踪新任务
    async trackTask(taskName, status = 'in-progress') {
        if (this.trackedTasks.has(taskName)) {
            return; // 已追踪
        }
        
        try {
            const taskData = {
                title: taskName,
                status: status,
                sessionId: this.sessionId,
                priority: 'medium',
                tags: ['auto-tracked']
            };
            
            const response = await this.post('/api/tasks', JSON.stringify(taskData));
            
            if (response && response.id) {
                this.trackedTasks.set(taskName, response.id);
                console.log(`[TaskAutoTracker] Task created: ${taskName}`);
            }
        } catch (err) {
            console.warn('[TaskAutoTracker] Failed to create task:', err.message);
        }
    }
    
    // 标记任务完成
    async markTaskComplete(taskName) {
        const taskId = this.trackedTasks.get(taskName);
        if (!taskId) {
            // 尝试查找最近的任务
            await this.findAndCompleteTask(taskName);
            return;
        }
        
        try {
            await this.put(`/api/tasks/${taskId}`, JSON.stringify({
                status: 'completed'
            }));
            this.trackedTasks.delete(taskName);
            console.log(`[TaskAutoTracker] Task completed: ${taskName}`);
        } catch (err) {
            console.warn('[TaskAutoTracker] Failed to update task:', err.message);
        }
    }
    
    // 查找并完成任务
    async findAndCompleteTask(taskName) {
        try {
            const response = await this.get('/api/tasks');
            const tasks = response.tasks || [];
            
            // 模糊匹配
            const task = tasks.find(t => 
                t.title.toLowerCase().includes(taskName.toLowerCase()) ||
                taskName.toLowerCase().includes(t.title.toLowerCase())
            );
            
            if (task) {
                await this.put(`/api/tasks/${task.id}`, JSON.stringify({
                    status: 'completed'
                }));
                console.log(`[TaskAutoTracker] Task completed (found): ${taskName}`);
            }
        } catch (err) {
            console.warn('[TaskAutoTracker] Failed to find task:', err.message);
        }
    }
    
    // 发送日志
    async sendHeartbeat(activity) {
        try {
            const data = JSON.stringify({
                projectKey: `${require('os').hostname()}:${process.cwd()}`,
                description: activity.substring(0, 100)
            });
            
            await this.post(`/api/sessions/${this.sessionId}/log`, data);
        } catch (err) {
            // 静默失败
        }
    }
    
    // HTTP 请求封装
    async request(method, path, data = null) {
        return new Promise((resolve, reject) => {
            const url = new URL(path, this.taskHubUrl);
            const options = {
                hostname: url.hostname,
                port: url.port || 80,
                path: url.pathname,
                method: method,
                headers: {
                    'Content-Type': 'application/json'
                }
            };
            
            const req = http.request(options, (res) => {
                let body = '';
                res.on('data', chunk => body += chunk);
                res.on('end', () => {
                    try {
                        resolve(JSON.parse(body));
                    } catch {
                        resolve(body);
                    }
                });
            });
            
            req.on('error', reject);
            if (data) req.write(data);
            req.end();
        });
    }
    
    get(path) {
        return this.request('GET', path);
    }
    
    post(path, data) {
        return this.request('POST', path, data);
    }
    
    put(path, data) {
        return this.request('PUT', path, data);
    }
}

// 导出为 OpenCode 插件格式
module.exports = {
    name: 'task-autotrack',
    version: '1.0.0',
    description: 'Auto track tasks to OpenCode Task Hub',
    
    onAgentOutput(output, context) {
        const tracker = new TaskAutoTracker();
        tracker.onAgentOutput(output, context);
    },
    
    // 快捷方法
    createTracker(config) {
        return new TaskAutoTracker(config);
    }
};
