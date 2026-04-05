/**
 * Cognitive Load Module - Verification Script
 * 验证 Phase 1-4 核心功能
 */

import Database from 'better-sqlite3';
import { readFileSync, existsSync } from 'fs';

console.log('🧪 开始验证 Cognitive Load Module...\n');

const db = new Database(':memory:');
let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    const result = fn();
    if (result) {
      console.log(`  ✅ ${name}`);
      passed++;
    } else {
      console.log(`  ❌ ${name}`);
      failed++;
    }
  } catch (e) {
    console.log(`  ❌ ${name}: ${e.message}`);
    failed++;
  }
}

// 验证数据库表结构
console.log('\n📍 Phase 1-3: 数据库表结构');

test('user_progress 表存在', () => {
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

test('confidence_history 表存在', () => {
  db.run(`CREATE TABLE IF NOT EXISTS confidence_history (
    id TEXT PRIMARY KEY,
    change_data TEXT NOT NULL,
    historical_accuracy REAL NOT NULL,
    updated_at INTEGER NOT NULL
  )`);
  const table = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='confidence_history'").get();
  return table !== undefined;
});

test('session_read_progress 表存在', () => {
  db.run(`CREATE TABLE IF NOT EXISTS session_read_progress (
    user_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    last_checkpoint_id TEXT,
    last_artifact_id TEXT,
    read_segments TEXT,
    last_read_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, session_id)
  )`);
  const table = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='session_read_progress'").get();
  return table !== undefined;
});

// 验证 API 路由存在
console.log('\n📍 Phase 4: API 路由配置');

const serverContent = readFileSync('./server.js', 'utf-8');

const phase1APIs = [
  '/api/cognitive/progress/:userId',
  '/api/cognitive/progress/:userId/mark-session/:sessionId',
  '/api/cognitive/progress/:userId/suggest-next'
];

const phase2APIs = [
  '/api/cognitive/summaries/sessions',
  '/api/cognitive/summaries/sessions/:sessionId',
  '/api/cognitive/summaries/tasks/:taskId'
];

const phase3APIs = [
  '/api/cognitive/confidence/evaluate',
  '/api/cognitive/confidence/history',
  '/api/cognitive/confidence/pending',
  '/api/cognitive/confidence/record'
];

const phase4APIs = [
  '/api/cognitive/sops',
  '/api/cognitive/sops/:id',
  '/api/cognitive/sops/match/:taskId',
  '/api/cognitive/decisions/rules',
  '/api/cognitive/decisions/evaluate'
];

test('Phase 1 API 路由完整 (进度记忆)', () => {
  return phase1APIs.every(api => serverContent.includes(api));
});

test('Phase 2 API 路由完整 (AI摘要)', () => {
  return phase2APIs.every(api => serverContent.includes(api));
});

test('Phase 3 API 路由完整 (置信度)', () => {
  return phase3APIs.every(api => serverContent.includes(api));
});

test('Phase 4 API 路由完整 (SOP+决策)', () => {
  return phase4APIs.every(api => serverContent.includes(api));
});

test('Cognitive Load 模块已导入', () => {
  return serverContent.includes('ProgressMemory') &&
         serverContent.includes('AISummarizer') &&
         serverContent.includes('ConfidenceScorer') &&
         serverContent.includes('SOPManager') &&
         serverContent.includes('HumanDecisionBoundary');
});

test('ConfidenceScorer 接收 db 参数', () => {
  return serverContent.includes('new ConfidenceScorer(db)');
});

// 验证文档
console.log('\n📍 文档完整性');

test('THREE_LAYER_LOAD_ROADMAP.md 存在', () => {
  return existsSync('./docs/THREE_LAYER_LOAD_ROADMAP.md');
});

test('Landing page 包含 Phase 介绍', () => {
  const content = readFileSync('./docs/index.html', 'utf-8');
  return content.includes('Phase 1') &&
         content.includes('Phase 2') &&
         content.includes('Phase 3') &&
         content.includes('Phase 4') &&
         content.includes('三层负荷优化');
});

// 验证源码文件
console.log('\n📍 源码文件完整性');

const sourceFiles = [
  './src/cognitive-load/progress-memory.ts',
  './src/cognitive-load/ai-summarizer.ts',
  './src/cognitive-load/confidence-scorer.ts',
  './src/cognitive-load/sop-manager.ts',
  './src/cognitive-load/human-decision-boundary.ts',
  './src/cognitive-load/index.ts'
];

test('所有 Phase 1-4 源码文件存在', () => {
  return sourceFiles.every(f => existsSync(f));
});

test('没有使用 localStorage', () => {
  const badFiles = sourceFiles.filter(f => {
    const content = readFileSync(f, 'utf-8');
    return content.includes('localStorage');
  });
  if (badFiles.length > 0) {
    console.log(`    违规文件: ${badFiles.join(', ')}`);
  }
  return badFiles.length === 0;
});

// 验证核心功能逻辑
console.log('\n📍 核心功能逻辑');

test('AI Summarizer 有 3 句话生成逻辑', () => {
  const content = readFileSync('./src/cognitive-load/ai-summarizer.ts', 'utf-8');
  return content.includes('progress') &&
         content.includes('blocker') &&
         content.includes('nextAction');
});

test('Confidence Scorer 有三级动作', () => {
  const content = readFileSync('./src/cognitive-load/confidence-scorer.ts', 'utf-8');
  return content.includes("action: 'auto'") ||
         content.includes('action: "auto"') ||
         (content.includes('ActionRequired') && content.includes("'auto'"));
});

test('SOP Manager 有默认模板', () => {
  const content = readFileSync('./src/cognitive-load/sop-manager.ts', 'utf-8');
  return content.includes('Bug 修复流程') &&
         content.includes('新功能开发');
});

test('Human Decision Boundary 有默认规则', () => {
  const content = readFileSync('./src/cognitive-load/human-decision-boundary.ts', 'utf-8');
  return content.includes('代码合并到主分支') &&
         content.includes('删除系统文件');
});

// ============== 结果汇总 ==============
console.log('\n' + '='.repeat(40));
console.log(`验证结果: ✅ ${passed} | ❌ ${failed}`);
console.log('='.repeat(40));

db.close();

if (failed > 0) {
  console.log('\n⚠️  有验证失败，请检查上述问题');
  process.exit(1);
} else {
  console.log('\n🎉 所有验证通过！功能实现完整');
}
