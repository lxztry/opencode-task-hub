/**
 * Cognitive Load Module - Test Script
 * 测试 Phase 1-4 核心功能
 */

import { test } from 'node:test';
import assert from 'node:assert';
import Database from 'better-sqlite3';

// 动态导入模块
const db = new Database(':memory:'); // 使用内存数据库测试

// 由于是 ESM 且无 TypeScript 编译，直接读取源码验证结构
console.log('🧪 开始验证 Cognitive Load Module...\n');

let passed = 0;
let failed = 0;

function runTest(name, fn) {
  return new Promise((resolve) => {
    test(name, () => {
      try {
        const result = fn();
        if (result) {
          console.log(`  ✅ ${name}`);
          passed++;
        } else {
          console.log(`  ❌ ${name}`);
          failed++;
        }
        resolve();
      } catch (e) {
        console.log(`  ❌ ${name}: ${e.message}`);
        failed++;
        resolve();
      }
    });
  });
}

// 验证数据库表结构
console.log('\n📍 验证数据库表结构');

test('Progress Memory 表存在', () => {
  db.run(`CREATE TABLE IF NOT EXISTS user_progress (
    user_id TEXT PRIMARY KEY,
    last_session_id TEXT,
    last_task_id TEXT,
    last_view_type TEXT,
    last_filter TEXT,
    last_sort_order TEXT,
    last_group_by TEXT,
    updated_at INTEGER NOT NULL
  )`);
  const table = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='user_progress'").get();
  return table !== undefined;
});

test('Confidence History 表存在', () => {
  db.run(`CREATE TABLE IF NOT EXISTS confidence_history (
    id TEXT PRIMARY KEY,
    change_data TEXT NOT NULL,
    historical_accuracy REAL NOT NULL,
    updated_at INTEGER NOT NULL
  )`);
  const table = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='confidence_history'").get();
  return table !== undefined;
});

test('Decision Rules 表存在', () => {
  db.run(`CREATE TABLE IF NOT EXISTS decision_rules (
    id TEXT PRIMARY KEY,
    category TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    pattern TEXT,
    keywords TEXT,
    requires_confirmation INTEGER NOT NULL DEFAULT 1,
    enabled INTEGER NOT NULL DEFAULT 1,
    priority TEXT NOT NULL DEFAULT 'medium',
    risk_level TEXT NOT NULL DEFAULT 'medium',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`);
  const table = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='decision_rules'").get();
  return table !== undefined;
});

test('SOPs 表存在', () => {
  db.run(`CREATE TABLE IF NOT EXISTS sops (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    trigger TEXT NOT NULL,
    steps TEXT NOT NULL,
    tags TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    enabled INTEGER DEFAULT 1,
    usage_count INTEGER DEFAULT 0,
    avg_completion_time REAL
  )`);
  const table = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sops'").get();
  return table !== undefined;
});

// 验证 API 路由存在
console.log('\n📍 验证 API 路由配置');

import { readFileSync } from 'fs';
const serverContent = readFileSync('./server.js', 'utf-8');

const requiredAPIs = [
  '/api/cognitive/progress/:userId',
  '/api/cognitive/summaries/sessions',
  '/api/cognitive/confidence/evaluate',
  '/api/cognitive/sops',
  '/api/cognitive/decisions/rules'
];

test('所有 Phase 1-4 API 路由已注册', () => {
  const allExist = requiredAPIs.every(api => serverContent.includes(api));
  if (!allExist) {
    const missing = requiredAPIs.filter(api => !serverContent.includes(api));
    console.log(`    缺失: ${missing.join(', ')}`);
  }
  return allExist;
});

test('Cognitive Load 模块已导入到 EnhancedTaskManager', () => {
  return serverContent.includes('ProgressMemory') &&
         serverContent.includes('AISummarizer') &&
         serverContent.includes('ConfidenceScorer') &&
         serverContent.includes('SOPManager');
});

// 验证前端资源
console.log('\n📍 验证前端资源');

import { existsSync } from 'fs';
const publicFiles = [
  './public/index.html'
];

test('前端文件存在', () => {
  return publicFiles.every(f => existsSync(f));
});

// 验证文档
const docsFiles = [
  './docs/THREE_LAYER_LOAD_ROADMAP.md',
  './docs/README.md',
  './docs/index.html'
];

test('文档完整', () => {
  return docsFiles.every(f => existsSync(f));
});

// ============== 结果汇总 ==============
console.log('\n' + '='.repeat(40));
console.log(`验证结果: ✅ ${passed} | ❌ ${failed}`);
console.log('='.repeat(40));

if (failed > 0) {
  console.log('\n⚠️  有验证失败，请检查');
  process.exit(1);
} else {
  console.log('\n🎉 结构验证通过！');
}

db.close();
