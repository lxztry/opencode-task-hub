/**
 * Cognitive Load Module - Test Script
 * 测试 Phase 1-4 核心功能
 */

import { Database } from '../src/database.js';
import { ProgressMemory } from '../src/cognitive-load/progress-memory.js';
import { AISummarizer } from '../src/cognitive-load/ai-summarizer.js';
import { ConfidenceScorer } from '../src/cognitive-load/confidence-scorer.js';
import { SOPManager } from '../src/cognitive-load/sop-manager.js';
import { HumanDecisionBoundary } from '../src/cognitive-load/human-decision-boundary.js';
import type { Session } from '../src/types.js';

console.log('🧪 开始测试 Cognitive Load Module...\n');

const db = new Database(':memory:'); // 使用内存数据库测试

let passed = 0;
let failed = 0;

function test(name: string, fn: () => boolean) {
  try {
    const result = fn();
    if (result) {
      console.log(`  ✅ ${name}`);
      passed++;
    } else {
      console.log(`  ❌ ${name}`);
      failed++;
    }
  } catch (e: any) {
    console.log(`  ❌ ${name}: ${e.message}`);
    failed++;
  }
}

// ============== Phase 1: Progress Memory ==============
console.log('\n📍 Phase 1: 进度连续性记忆');

test('保存和获取用户位置', () => {
  const pm = new ProgressMemory(db);
  pm.saveUserPosition({
    userId: 'user1',
    lastSessionId: 'session123',
    lastTaskId: 'task456',
    lastViewType: 'board'
  });
  const pos = pm.getUserPosition('user1');
  return pos?.lastSessionId === 'session123' && pos?.lastTaskId === 'task456';
});

test('标记Session访问', () => {
  const pm = new ProgressMemory(db);
  pm.markSessionAccessed('user1', 'session789');
  const pos = pm.getUserPosition('user1');
  return pos?.lastSessionId === 'session789';
});

test('推荐下一个Session', () => {
  const pm = new ProgressMemory(db);
  pm.markSessionAccessed('user1', 'session1');
  const sessions = [
    { id: 'session1', status: 'active', createdAt: Date.now() - 1000 },
    { id: 'session2', status: 'active', createdAt: Date.now() - 2000 },
    { id: 'session3', status: 'completed', createdAt: Date.now() }
  ];
  const next = pm.suggestNextSession('user1', sessions);
  return next === 'session1';
});

// ============== Phase 2: AI Summarizer ==============
console.log('\n📍 Phase 2: AI上下文摘要');

test('生成Session摘要', async () => {
  const summarizer = new AISummarizer();
  const session: Partial<Session> = {
    id: 'test1',
    name: 'Test Session',
    status: 'active',
    type: 'task',
    context: {
      files: ['file1.ts', 'file2.ts'],
      tasks: ['task1', 'task2'],
      artifacts: [],
      keyDecisions: ['决策1'],
      blockers: ['阻碍1']
    },
    checkpoints: [],
    tags: ['test'],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    metadata: { creator: 'test', assignees: [], priority: 'medium', labels: [], customFields: {} }
  };
  const summary = await summarizer.summarizeSession(session as Session);
  return summary.progress !== undefined && summary.blocker !== undefined && summary.nextAction !== undefined;
});

test('生成Task摘要', () => {
  const summarizer = new AISummarizer();
  const summary = summarizer.summarizeTask({
    id: 'task1',
    title: 'Test Task',
    status: 'in-progress',
    priority: 'high'
  });
  return summary.status.includes('进行中') && summary.nextStep !== undefined;
});

// ============== Phase 3: Confidence Scorer ==============
console.log('\n📍 Phase 3: 置信度指标');

test('评估置信度', () => {
  const cs = new ConfidenceScorer(db);
  const result = cs.evaluateConfidence({
    outputType: 'task-creation',
    outputContent: '创建了一个新任务'
  });
  return result.score >= 0 && result.score <= 1 && result.level !== undefined;
});

test('置信度颜色返回', () => {
  const cs = new ConfidenceScorer(db);
  const greenColor = cs.getConfidenceColor(0.96);
  const yellowColor = cs.getConfidenceColor(0.80);
  const redColor = cs.getConfidenceColor(0.50);
  return greenColor === '#22c55e' && yellowColor === '#eab308' && redColor === '#ef4444';
});

test('记录变更', () => {
  const cs = new ConfidenceScorer(db);
  const record = cs.recordChange({
    actionType: 'create',
    targetType: 'task',
    targetId: 'task1',
    targetName: 'Test Task',
    confidence: 0.92
  });
  return record.id.startsWith('change_') && record.confidence === 0.92;
});

test('获取变更历史', () => {
  const cs = new ConfidenceScorer(db);
  cs.recordChange({
    actionType: 'update',
    targetType: 'task',
    targetId: 'task2',
    targetName: 'Updated Task',
    confidence: 0.85
  });
  const history = cs.getChangeHistory(5);
  return history.length > 0;
});

// ============== Phase 4: SOP Manager ==============
console.log('\n📍 Phase 4: SOP管理');

test('获取默认SOP', () => {
  const sop = new SOPManager(db);
  const sops = sop.getAllSOPs();
  return sops.length >= 3; // 应该有3个默认SOP
});

test('匹配SOP', () => {
  const sop = new SOPManager(db);
  const matched = sop.matchSOP({ tags: ['bug'], title: 'Fix login bug' });
  return matched?.name === 'Bug 修复流程';
});

test('启动SOP执行', () => {
  const sop = new SOPManager(db);
  const sops = sop.getAllSOPs();
  if (sops.length === 0) return false;
  const exec = sop.startExecution(sops[0].id, { taskId: 'task1' });
  return exec?.status === 'running';
});

// ============== Phase 4: Human Decision Boundary ==============
console.log('\n📍 Phase 4: 人类决策边界');

test('评估是否需要确认', () => {
  const hdb = new HumanDecisionBoundary(db);
  const result = hdb.quickCheck('code_commit', 'merge to master branch');
  return result.requiresHumanDecision === true;
});

test('普通操作不需要确认', () => {
  const hdb = new HumanDecisionBoundary(db);
  const result = hdb.quickCheck('update', 'update task status');
  return result.requiresHumanDecision === false;
});

test('获取必须确认的规则', () => {
  const hdb = new HumanDecisionBoundary(db);
  const rules = hdb.getConfirmationRequiredRules();
  return rules.length > 0 && rules.every(r => r.requiresConfirmation);
});

// ============== 结果汇总 ==============
console.log('\n' + '='.repeat(40));
console.log(`测试结果: ✅ ${passed} | ❌ ${failed}`);
console.log('='.repeat(40));

if (failed > 0) {
  console.log('\n⚠️  有测试失败，请检查上述功能');
  process.exit(1);
} else {
  console.log('\n🎉 所有测试通过！功能正常');
}

db.close();
