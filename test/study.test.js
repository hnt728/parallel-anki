import test from 'node:test';
import assert from 'node:assert/strict';
import { applyAction, dashboard, dueCards } from '../src/study.js';

const now = new Date('2026-11-23T08:20:00Z');
const zone = 'Asia/Tokyo';

test('grading schedules the first attempt and carries only wrong answers into each retry', () => {
  const state = { collections: [], cards: [], session: null };
  const act = action => applyAction(state, action, now, zone);
  act({ type: 'saveCollection', name: '言葉' });
  const collectionId = state.collections[0].id;
  act({ type: 'saveCard', collectionId, prompt: 'りんご', answers: 'apple\nan apple' });
  act({ type: 'saveCard', collectionId, prompt: 'みかん', answers: 'mandarin' });
  const [apple, mandarin] = state.cards;
  act({ type: 'start', mode: 'web' });
  const sessionId = state.session.id;
  assert.equal(dashboard(state, now, zone).session.questions[0].answers, undefined);
  act({ type: 'submit', sessionId, round: 1, answers: { [apple.id]: ' ＡＰＰＬＥ　', [mandarin.id]: 'orange' } });
  assert.deepEqual(state.session.results.map(result => result.correct), [true, false]);
  assert.equal(state.session.status, 'retry');
  assert.equal(dueCards(state, now, zone).length, 0);
  const firstSchedule = mandarin.schedule;
  act({ type: 'start', sessionId, round: 1, mode: 'paper' });
  assert.deepEqual(state.session.questions.map(question => question.id), [mandarin.id]);
  act({ type: 'submit', sessionId, round: 2, answers: {} });
  act({ type: 'start', sessionId, round: 2, mode: 'web' });
  act({ type: 'submit', sessionId, round: 3, answers: { [mandarin.id]: 'mandarin' } });
  assert.equal(state.session.status, 'complete');
  assert.strictEqual(mandarin.schedule, firstSchedule);
  act({ type: 'close', sessionId });
  assert.equal(state.session, null);
  assert.ok(dueCards(state, new Date('2027-01-01'), zone).some(card => card.id === mandarin.id));
});

test('editing an active card preserves the worksheet and resets the changed card schedule', () => {
  const state = { collections: [{ id: 'deck', name: 'Deck' }], cards: [
    { id: 'question', prompt: 'Original', answers: ['original'], collectionId: 'deck', schedule: null },
  ], session: null };
  applyAction(state, { type: 'start', mode: 'paper' }, now, zone);
  applyAction(state, { type: 'saveCard', id: 'question', collectionId: 'deck', prompt: 'Changed', answers: 'changed' }, now, zone);
  applyAction(state, { type: 'submit', sessionId: state.session.id, round: 1, answers: { question: 'original' } }, now, zone);
  assert.equal(state.session.status, 'complete');
  assert.equal(state.cards[0].schedule, null);
});
