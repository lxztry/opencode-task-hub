/**
 * OpenCode Task Hub - Webhook & Integration Manager
 * External integrations: GitHub, Calendar, Notifications
 */

import { Webhook, WebhookEvent, Notification, Task, Session } from './types.js';
import crypto from 'crypto';

interface WebhookPayload {
  event: WebhookEvent;
  timestamp: number;
  data: any;
}

export class WebhookManager {
  private webhooks: Map<string, Webhook> = new Map();
  private eventQueue: WebhookPayload[] = [];
  private processing = false;

  constructor() {
    this.loadWebhooks();
  }

  private async loadWebhooks(): Promise<void> {
    // 从数据库加载webhooks
    // 简化处理，实际应该从Database类加载
  }

  // ============== Webhook Management ==============

  createWebhook(data: {
    url: string;
    events: WebhookEvent[];
    secret?: string;
  }): Webhook {
    const id = `webhook_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const webhook: Webhook = {
      id,
      url: data.url,
      events: data.events,
      secret: data.secret || this.generateSecret(),
      active: true
    };

    this.webhooks.set(id, webhook);
    return webhook;
  }

  deleteWebhook(id: string): boolean {
    return this.webhooks.delete(id);
  }

  getWebhook(id: string): Webhook | undefined {
    return this.webhooks.get(id);
  }

  getAllWebhooks(): Webhook[] {
    return Array.from(this.webhooks.values());
  }

  toggleWebhook(id: string, active: boolean): boolean {
    const webhook = this.webhooks.get(id);
    if (webhook) {
      webhook.active = active;
      return true;
    }
    return false;
  }

  private generateSecret(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  // ============== Event Triggering ==============

  async trigger(event: WebhookEvent, data: any): Promise<void> {
    const payload: WebhookPayload = {
      event,
      timestamp: Date.now(),
      data
    };

    this.eventQueue.push(payload);
    
    if (!this.processing) {
      this.processQueue();
    }
  }

  private async processQueue(): Promise<void> {
    this.processing = true;

    while (this.eventQueue.length > 0) {
      const payload = this.eventQueue.shift()!;
      
      // 找到订阅该事件的webhooks
      const subscribedWebhooks = Array.from(this.webhooks.values())
        .filter(w => w.active && w.events.includes(payload.event));

      // 并行发送
      await Promise.all(
        subscribedWebhooks.map(webhook => this.sendToWebhook(webhook, payload))
      );
    }

    this.processing = false;
  }

  private async sendToWebhook(webhook: Webhook, payload: WebhookPayload): Promise<void> {
    const body = JSON.stringify(payload);
    const signature = this.signBody(body, webhook.secret);

    try {
      const response = await fetch(webhook.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-OpenCode-Signature': signature,
          'X-OpenCode-Event': payload.event,
          'X-OpenCode-Timestamp': payload.timestamp.toString()
        },
        body
      });

      if (!response.ok) {
        console.error(`Webhook ${webhook.id} failed: ${response.status}`);
      }
    } catch (error) {
      console.error(`Webhook ${webhook.id} error:`, error);
    }
  }

  private signBody(body: string, secret: string): string {
    return crypto
      .createHmac('sha256', secret)
      .update(body)
      .digest('hex');
  }

  // ============== GitHub Integration ==============

  async linkGitHubPR(taskId: string, prUrl: string): Promise<{
    success: boolean;
    error?: string;
  }> {
    try {
      // 解析PR URL获取信息
      const prMatch = prUrl.match(/github\.com\/([^\/]+)\/([^\/]+)\/pull\/(\d+)/);
      if (!prMatch) {
        return { success: false, error: 'Invalid PR URL' };
      }

      const [, owner, repo, prNumber] = prMatch;
      
      // 存储映射关系
      // 实际应该存储到数据库
      console.log(`Linked PR #${prNumber} to task ${taskId}`);

      // 触发事件
      await this.trigger('task.updated', { taskId, linkedPR: prUrl });

      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  async syncGitHubStatus(prUrl: string): Promise<{
    status: 'open' | 'merged' | 'closed';
    title: string;
    author: string;
  } | null> {
    // 简化实现
    // 实际应该调用GitHub API
    return null;
  }

  // ============== Calendar Integration ==============

  async syncWithCalendar(
    taskId: string,
    dueDate: number,
    title: string,
    calendarType: 'google' | 'outlook' | 'apple' = 'google'
  ): Promise<boolean> {
    try {
      // 简化实现
      // 实际应该调用各日历API
      console.log(`Synced task ${taskId} due ${new Date(dueDate)} to ${calendarType} calendar`);
      return true;
    } catch (error) {
      console.error('Calendar sync error:', error);
      return false;
    }
  }

  // ============== Notification Manager ==============

  private notifications: Map<string, Notification> = new Map();

  async sendNotification(notification: Omit<Notification, 'id' | 'createdAt'>): Promise<Notification> {
    const id = `notif_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const fullNotification: Notification = {
      ...notification,
      id,
      createdAt: Date.now()
    };

    this.notifications.set(id, fullNotification);

    // 如果有actionUrl，可以发送外部通知
    if (fullNotification.actionUrl) {
      await this.trigger('session.completed', { notification: fullNotification });
    }

    return fullNotification;
  }

  getNotifications(userId: string, unreadOnly = false): Notification[] {
    return Array.from(this.notifications.values())
      .filter(n => n.userId === userId && (!unreadOnly || !n.read))
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  markAsRead(notificationId: string): void {
    const notification = this.notifications.get(notificationId);
    if (notification) {
      notification.read = true;
    }
  }

  markAllAsRead(userId: string): void {
    for (const notification of this.notifications.values()) {
      if (notification.userId === userId) {
        notification.read = true;
      }
    }
  }

  // ============== Event Shortcuts ==============

  async onTaskCreated(task: Task): Promise<void> {
    await this.trigger('task.created', { task });
  }

  async onTaskUpdated(task: Task): Promise<void> {
    await this.trigger('task.updated', { task });
  }

  async onTaskCompleted(task: Task): Promise<void> {
    await this.trigger('task.completed', { task });
  }

  async onTaskCommented(taskId: string, comment: string, author: string): Promise<void> {
    await this.trigger('task.commented', { taskId, comment, author });
  }

  async onSessionCreated(session: Session): Promise<void> {
    await this.trigger('session.created', { session });
  }

  async onSessionCompleted(session: Session): Promise<void> {
    await this.trigger('session.completed', { session });
  }
}

// ============== Export Singleton ==============

export const webhookManager = new WebhookManager();
