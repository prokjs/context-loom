import test from 'node:test';
import assert from 'node:assert/strict';
import { compileContext, calculateUsage, validateState } from '../core.mjs';

const memory = (id, text, extra = {}) => ({ id, text, tags: '', pinned: false, enabled: true, ...extra });
const project = (memories) => ({ id: 'alpha', name: 'Alpha', goal: 'Ship a billing app', scope: 'Billing only', constraints: 'Never change invoice totals', style: 'concise', clarification: 'blocking', memories });

// These are consumer invariants, independent of exact generated wording.
test('disabled and unrelated project memories cannot enter compiled context', () => {
  const result = compileContext(project([
    memory('visible', 'Invoice amounts use integer cents', { pinned: true }),
    memory('hidden', 'PRIVATE_DISABLED_FACT', { enabled: false, pinned: true })
  ]), { projectId: 'alpha', task: 'Fix invoice rounding', memoryBudget: 1000, maxOutputTokens: 512, reasoning: 'low' });
  assert.ok(result.selectedMemoryIds.includes('visible'));
  assert.ok(!result.selectedMemoryIds.includes('hidden'));
  assert.ok(!result.prompt.includes('PRIVATE_DISABLED_FACT'));
  assert.ok(result.prompt.includes('Fix invoice rounding'));
  assert.ok(result.prompt.includes('Never change invoice totals'));
});

test('zero memory allowance excludes even pinned memories without deleting them', () => {
  const p = project([memory('pinned', 'Invoice rules', { pinned: true })]);
  const result = compileContext(p, { projectId: 'alpha', task: 'Fix invoices', memoryBudget: 0, maxOutputTokens: 512, reasoning: 'none' });
  assert.deepEqual(result.selectedMemoryIds, []);
  assert.ok(result.omittedMemoryIds.includes('pinned'));
  assert.equal(p.memories[0].text, 'Invoice rules');
});

test('irrelevant memories stay out while explicit pins survive relevance filtering', () => {
  const result = compileContext(project([
    memory('match', 'Invoice rounding uses cents', { tags: 'invoice' }),
    memory('irrelevant', 'The garden has lavender'),
    memory('pin', 'Release owner is Alex', { pinned: true }),
    memory('duplicate', ' invoice   rounding uses CENTS ', { tags: 'invoice' })
  ]), { projectId: 'alpha', task: 'Fix invoice rounding and explain only the necessary changes', memoryBudget: 1000, maxOutputTokens: 512, reasoning: 'low' });
  assert.deepEqual(result.selectedMemoryIds, ['pin', 'match']);
  assert.ok(result.omittedMemoryIds.includes('irrelevant'));
  assert.ok(result.omittedMemoryIds.includes('duplicate'));
});

test('reasoning tokens are not charged twice and cached input receives its own rate', () => {
  const usage = calculateUsage({ usage: { input_tokens: 1000, input_tokens_details: { cached_tokens: 400, cache_write_tokens: 0 }, output_tokens: 200, output_tokens_details: { reasoning_tokens: 150 } } });
  assert.equal(usage.reasoningTokens, 150);
  assert.ok(Math.abs(usage.costUSD - 0.000164) < 1e-12);
});

test('cache write premium is included in usage-derived costs', () => {
  const usage = calculateUsage({ usage: { input_tokens: 1000, input_tokens_details: { cached_tokens: 400, cache_write_tokens: 200 }, output_tokens: 200, output_tokens_details: { reasoning_tokens: 0 } } });
  assert.ok(Math.abs(usage.costUSD - 0.000169) < 1e-12);
});

test('missing usage cannot be represented as a free API response', () => {
  assert.equal(calculateUsage({}).costUSD, null);
});

test('older project data upgrades without losing memories and rejects unsupported languages', () => {
  const old = { projects: [project([memory('fact', 'Preserve invoice totals')])], activeProjectId: 'alpha' };
  const upgraded = validateState(old);
  assert.equal(upgraded.projects[0].answerLanguage, 'auto');
  assert.equal(upgraded.uiLanguage, 'en');
  assert.deepEqual(upgraded.projects[0].memories, old.projects[0].memories);
  const korean = validateState({ ...upgraded, uiLanguage: 'ko', projects: [{ ...upgraded.projects[0], answerLanguage: 'ja' }] });
  assert.equal(korean.uiLanguage, 'ko');
  assert.equal(korean.projects[0].answerLanguage, 'ja');
  assert.throws(() => validateState({ ...upgraded, uiLanguage: '../../private' }), { status: 400 });
  assert.throws(() => validateState({ ...upgraded, projects: [{ ...upgraded.projects[0], answerLanguage: 'unsupported' }] }), { status: 400 });
});

test('unspaced CJK tasks and Korean particles retrieve relevant memories without unrelated entries', () => {
  for (const [task, fact, unrelated] of [
    ['修复发票金额', '发票金额以整数分存储', '花园种薰衣草'],
    ['영수증을 수정해 주세요', '영수증 금액은 정수 단위로 저장합니다', '정원에는 라벤더가 자랍니다'],
    ['請求額を修正してください', '請求額は整数のセントで保存する', '庭にはラベンダーがある'],
  ]) {
    const result = compileContext(project([memory('relevant', fact), memory('unrelated', unrelated)]),
      { projectId: 'alpha', task, memoryBudget: 1000, maxOutputTokens: 512, reasoning: 'low' });
    assert.deepEqual(result.selectedMemoryIds, ['relevant']);
    assert.equal(JSON.parse(result.input).task, task);
  }
});
