import { test, describe } from 'node:test';
import assert from 'node:assert';

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

describe('任务提取测试', () => {
  test('帮我添加用户登录功能', () => {
    const result = extractTaskFromMessage('帮我添加用户登录功能');
    assert.strictEqual(result, '添加用户登录功能');
  });

  test('请帮我优化数据库查询性能', () => {
    const result = extractTaskFromMessage('请帮我优化数据库查询性能');
    assert.strictEqual(result, '帮我优化数据库查询性能');
  });

  test('请添加一个导航栏组件', () => {
    const result = extractTaskFromMessage('请添加一个导航栏组件');
    assert.strictEqual(result, '添加一个导航栏组件');
  });

  test('我想创建一个商品列表页面', () => {
    const result = extractTaskFromMessage('我想创建一个商品列表页面');
    assert.strictEqual(result, '创建一个商品列表页面');
  });

  test('需要修复首页样式问题', () => {
    const result = extractTaskFromMessage('需要修复首页样式问题');
    assert.strictEqual(result, '修复首页样式问题');
  });

  test('能不能帮我重构这段代码', () => {
    const result = extractTaskFromMessage('能不能帮我重构这段代码');
    assert.strictEqual(result, '帮我重构这段代码');
  });

  test('实现一个用户权限管理系统', () => {
    const result = extractTaskFromMessage('实现一个用户权限管理系统');
    assert.strictEqual(result, '实现一个用户权限管理系统');
  });

  test('修复登录页面白屏bug', () => {
    const result = extractTaskFromMessage('修复登录页面白屏bug');
    assert.strictEqual(result, '修复登录页面白屏bug');
  });

  test('优化图片加载速度', () => {
    const result = extractTaskFromMessage('优化图片加载速度');
    assert.strictEqual(result, '优化图片加载速度');
  });

  test('任务: 完善用户资料编辑功能', () => {
    const result = extractTaskFromMessage('任务: 完善用户资料编辑功能');
    assert.strictEqual(result, '完善用户资料编辑功能');
  });

  test('.task 添加单元测试', () => {
    const result = extractTaskFromMessage('.task 添加单元测试');
    assert.strictEqual(result, '添加单元测试');
  });

  test('普通对话不提取', () => {
    const result = extractTaskFromMessage('今天天气怎么样？');
    assert.strictEqual(result, null);
  });

  test('问问题不提取', () => {
    const result = extractTaskFromMessage('这个函数是干什么的？');
    assert.strictEqual(result, null);
  });

  test('过短消息不提取', () => {
    const result = extractTaskFromMessage('帮我');
    assert.strictEqual(result, null);
  });
});
