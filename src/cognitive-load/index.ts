/**
 * Cognitive Load Module - Main Index
 * Phase 1-4 Implementation Bundle
 * 
 * 三层负荷优化方案：
 * - Phase 1: 进度连续性记忆 (progress-memory.ts)
 * - Phase 2: AI上下文摘要 (ai-summarizer.ts)
 * - Phase 3: 置信度指标 (confidence-scorer.ts)
 * - Phase 4: SOP管理 (sop-manager.ts) + 人类决策边界 (human-decision-boundary.ts)
 */

export { ProgressMemory } from './progress-memory.js';
export { AISummarizer } from './ai-summarizer.js';
export { ConfidenceScorer } from './confidence-scorer.js';
export { SOPManager } from './sop-manager.js';
export { HumanDecisionBoundary } from './human-decision-boundary.js';

// Re-export types
export type { UserPosition, SessionReadProgress } from './progress-memory.js';
export type { SessionSummary, TaskSummary } from './ai-summarizer.js';
export type { ConfidenceResult, ConfidenceFactor, ChangeRecord, ConfidenceLevel, ActionRequired } from './confidence-scorer.js';
export type { SOP, SOPStep, SOPStepResult, SOPExecution, SOPTrigger, SOPStepType } from './sop-manager.js';
export type { DecisionRule, OperationContext, DecisionResult, OperationCategory } from './human-decision-boundary.js';
