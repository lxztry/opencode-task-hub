/**
 * Cognitive Load Module - Main Index
 * Phase 1-3 Implementation Bundle
 * 
 * 三层负荷优化方案：
 * - Phase 1: 进度连续性记忆 (progress-memory.ts)
 * - Phase 2: AI上下文摘要 (ai-summarizer.ts)
 * - Phase 3: 置信度指标 (confidence-scorer.ts)
 */

export { ProgressMemory } from './progress-memory.js';
export { AISummarizer } from './ai-summarizer.js';
export { ConfidenceScorer } from './confidence-scorer.js';

// Re-export types
export type { UserPosition, SessionReadProgress } from './progress-memory.js';
export type { SessionSummary, TaskSummary } from './ai-summarizer.js';
export type { ConfidenceResult, ConfidenceFactor, ChangeRecord, ConfidenceLevel, ActionRequired } from './confidence-scorer.js';
