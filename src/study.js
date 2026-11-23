import { createEmptyCard, fsrs, Rating } from 'ts-fsrs';
import { cardFieldIssue, MAX_COLLECTION_NAME, MAX_IMPORT_CARDS } from './card-data.js';

const scheduler = fsrs({ enable_short_term: false, enable_fuzz: false });
const uuid = () => crypto.randomUUID();

export class StudyError extends Error {}

function requireInput(condition, message) {
  if (!condition) throw new StudyError(message);
}

export function normalize(value) {
  return value.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase();
}

export function dayKey(date, timeZone) {
  return new Intl.DateTimeFormat('sv-SE', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

export function dueCards(state, now, timeZone) {
  const today = dayKey(now, timeZone);
  return state.cards.filter(card => !card.schedule || dayKey(new Date(card.schedule.due), timeZone) <= today);
}

export function dashboard(state, now, timeZone) {
  const due = dueCards(state, now, timeZone);
  const session = state.session;
  return {
    collections: state.collections.map(collection => ({
      ...collection,
      count: state.cards.filter(card => card.collectionId === collection.id).length,
      due: due.filter(card => card.collectionId === collection.id).length,
    })),
    fresh: due.filter(card => !card.schedule).length,
    review: due.filter(card => card.schedule).length,
    session: session && {
      id: session.id, round: session.round, status: session.status,
      mode: session.mode, results: session.results,
      questions: session.questions.map(({ id, prompt, collection }) => ({ id, prompt, collection })),
    },
  };
}

function requiredText(value, limit, message) {
  requireInput(typeof value === 'string' && value.trim().length > 0 && value.trim().length <= limit, message);
  return value.trim();
}

function cardKey(collectionId, prompt, answers) {
  return JSON.stringify([collectionId, normalize(prompt), [...new Set(answers.map(normalize))].sort()]);
}

function importCards(state, action) {
  const { cards, destination, skipDuplicates } = action;
  requireInput(['new', 'existing', 'source'].includes(destination) && typeof skipDuplicates === 'boolean' &&
    Array.isArray(cards) && cards.length > 0 && cards.length <= MAX_IMPORT_CARDS, 'インポート設定を確認してください。');
  const nameMessage = 'コレクション名を80文字以内で入力してください。';
  const existing = state.collections.find(collection => collection.id === action.collectionId);
  if (destination === 'existing') requireInput(existing, 'コレクションが見つかりません。');
  const name = destination === 'new' ? requiredText(action.name, MAX_COLLECTION_NAME, nameMessage) : null;
  if (name) requireInput(!state.collections.some(collection => collection.name === name),
    '同じ名前のコレクションがあります。既存のコレクションを選ぶか、名前を変えてください。');

  const imported = cards.map((item, index) => {
    const issue = cardFieldIssue(item?.prompt, item?.answers);
    requireInput(!issue, `インポートデータの${index + 1}件目。 ${issue}`);
    return {
      prompt: item.prompt.trim(), answers: item.answers.map(answer => answer.trim()),
      source: destination === 'source' ? requiredText(item.source, MAX_COLLECTION_NAME, nameMessage) : name,
    };
  });
  const byName = new Map();
  for (const collection of state.collections) {
    if (!byName.has(collection.name)) byName.set(collection.name, collection);
  }
  const keys = skipDuplicates ? new Set(state.cards.map(card => cardKey(card.collectionId, card.prompt, card.answers))) : null;
  const collectionIds = new Set();
  let added = 0;
  let duplicates = 0;
  for (const { prompt, answers, source } of imported) {
    let collection = destination === 'existing' ? existing : byName.get(source);
    if (!collection) {
      collection = { id: uuid(), name: source };
      byName.set(source, collection);
      state.collections.push(collection);
    }
    const key = keys && cardKey(collection.id, prompt, answers);
    collectionIds.add(collection.id);
    if (keys?.has(key)) {
      duplicates++;
      continue;
    }
    keys?.add(key);
    state.cards.push({ id: uuid(), collectionId: collection.id, prompt, answers, schedule: null });
    added++;
  }
  return { added, duplicates, collectionIds: [...collectionIds] };
}

function advanceSchedule(card, correct, now, timeZone) {
  const previous = card.schedule;
  const fsrsCard = previous ? {
    ...previous,
    due: new Date(previous.due),
    last_review: new Date(previous.last_review),
  } : createEmptyCard(now);
  const { card: next } = scheduler.next(fsrsCard, now, correct ? Rating.Good : Rating.Again);
  if (dayKey(next.due, timeZone) <= dayKey(now, timeZone)) {
    next.due = new Date(now.getTime() + 86_400_000);
  }
  card.schedule = next;
}

export function applyAction(state, action, now, timeZone) {
  switch (action.type) {
    case 'saveCollection': {
      const name = requiredText(action.name, 80, 'コレクション名を80文字以内で入力してください。');
      const collection = state.collections.find(item => item.id === action.id);
      if (action.id) requireInput(collection, 'コレクションが見つかりません。');
      if (collection) collection.name = name;
      else state.collections.push({ id: uuid(), name });
      break;
    }
    case 'saveCard': {
      requireInput(state.collections.some(item => item.id === action.collectionId), 'コレクションが見つかりません。');
      const answers = typeof action.answers === 'string' && action.answers.length <= 3000
        ? action.answers.split('\n').map(answer => answer.trim()).filter(Boolean) : [];
      const issue = cardFieldIssue(action.prompt, answers);
      requireInput(!issue, issue);
      const prompt = action.prompt.trim();
      const card = state.cards.find(item => item.id === action.id);
      if (action.id) requireInput(card?.collectionId === action.collectionId, '問題が見つかりません。');
      if (card) {
        if (card.prompt !== prompt || JSON.stringify(card.answers) !== JSON.stringify(answers)) card.schedule = null;
        Object.assign(card, { prompt, answers });
      } else state.cards.push({ id: uuid(), collectionId: action.collectionId, prompt, answers, schedule: null });
      break;
    }
    case 'importCards':
      return importCards(state, action);
    case 'deleteCard':
      state.cards = state.cards.filter(card => card.id !== action.id);
      break;
    case 'deleteCollection':
      state.collections = state.collections.filter(collection => collection.id !== action.id);
      state.cards = state.cards.filter(card => card.collectionId !== action.id);
      break;
    case 'start': {
      requireInput(['web', 'paper'].includes(action.mode), '解答方法を選んでください。');
      const session = state.session;
      if (session?.status === 'answering') {
        requireInput(action.sessionId === session.id && action.round === session.round, '復習画面を更新してください。');
        session.mode = action.mode;
        break;
      }
      if (session?.status === 'retry') {
        requireInput(action.sessionId === session.id && action.round === session.round, '復習画面を更新してください。');
        const wrong = new Set(session.results.filter(result => !result.correct).map(result => result.id));
        state.session = { ...session, round: session.round + 1, mode: action.mode, status: 'answering',
          questions: session.questions.filter(question => wrong.has(question.id)), results: [] };
        break;
      }
      requireInput(!action.sessionId, '復習画面を更新してください。');
      const questions = dueCards(state, now, timeZone).map(card => ({
        id: card.id, prompt: card.prompt, answers: card.answers,
        collection: state.collections.find(item => item.id === card.collectionId)?.name ?? '',
      }));
      requireInput(questions.length, '今日の問題はありません。');
      state.session = { id: uuid(), round: 1, status: 'answering', mode: action.mode, questions, results: [] };
      break;
    }
    case 'submit': {
      const session = state.session;
      requireInput(session?.id === action.sessionId && session.round === action.round, '復習画面を更新してください。');
      if (session.status !== 'answering') break;
      requireInput(action.answers && typeof action.answers === 'object', '解答を確認してください。');
      session.results = session.questions.map(question => {
        const answer = action.answers[question.id] ?? '';
        requireInput(typeof answer === 'string' && answer.length <= 1000, '解答は1000文字以内で入力してください。');
        const correct = Boolean(normalize(answer)) && question.answers.some(expected => normalize(expected) === normalize(answer));
        const card = state.cards.find(item => item.id === question.id);
        if (session.round === 1 && card?.prompt === question.prompt &&
            JSON.stringify(card.answers) === JSON.stringify(question.answers)) {
          advanceSchedule(card, correct, now, timeZone);
        }
        return { ...question, answer, correct };
      });
      session.status = session.results.every(result => result.correct) ? 'complete' : 'retry';
      break;
    }
    case 'close':
      requireInput(state.session?.id === action.sessionId && state.session.status === 'complete', '復習画面を更新してください。');
      state.session = null;
      break;
    default:
      throw new StudyError('操作が見つかりません。');
  }
}
