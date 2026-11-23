import { createRemoteJWKSet, jwtVerify } from 'jose';
import { applyAction, dashboard, StudyError } from './study.js';
import { OCR_MODEL, ocrRequest, readTranscription } from './ocr.js';

const jwksByIssuer = new Map();
const json = (data, status = 200) => Response.json(data, { status, headers: { 'cache-control': 'no-store' } });

async function authorized(request, env) {
  const url = new URL(request.url);
  if (env.LOCAL_DEV === 'yes' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return true;
  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!token || !env.ACCESS_TEAM || !env.ACCESS_AUD) return false;
  const issuer = `https://${env.ACCESS_TEAM}`;
  try {
    if (!jwksByIssuer.has(issuer)) {
      jwksByIssuer.set(issuer, createRemoteJWKSet(new URL('/cdn-cgi/access/certs', issuer)));
    }
    await jwtVerify(token, jwksByIssuer.get(issuer), {
      issuer, audience: env.ACCESS_AUD, algorithms: ['RS256'], requiredClaims: ['exp'],
    });
    return true;
  } catch {
    return false;
  }
}

async function body(request) {
  if (!request.headers.get('content-type')?.startsWith('application/json') ||
      request.headers.get('origin') !== new URL(request.url).origin ||
      Number(request.headers.get('content-length')) > 2_000_000) {
    throw new StudyError('リクエストを確認してください。');
  }
  const raw = await request.text();
  if (raw.length > 2_000_000) throw new StudyError('一度に送信できるサイズを超えています。');
  let value;
  try { value = JSON.parse(raw); }
  catch { throw new StudyError('リクエストを確認してください。'); }
  if (!value || typeof value !== 'object') throw new StudyError('リクエストを確認してください。');
  return value;
}

function timezone(request) {
  const name = request.headers.get('X-Time-Zone') ?? 'Asia/Tokyo';
  try { return new Intl.DateTimeFormat('ja', { timeZone: name }).resolvedOptions().timeZone; }
  catch { return 'Asia/Tokyo'; }
}

async function load(db) {
  const row = await db.prepare('SELECT revision, state FROM workspace WHERE id = 1').first();
  if (!row) throw new Error('Workspace migration missing');
  return { revision: row.revision, state: JSON.parse(row.state) };
}

function view(state, now, zone, revision) {
  return { ...dashboard(state, now, zone), revision };
}

async function transcribe(request, env) {
  const { sessionId, round, page, image } = await body(request);
  const { state } = await load(env.DB);
  const session = state.session;
  if (!session || session.id !== sessionId || session.round !== round || session.status !== 'answering' ||
      session.mode !== 'paper' || !Number.isInteger(page) || page < 0 || page * 5 >= session.questions.length ||
      typeof image !== 'string' || image.length > 1_800_000 || !/^data:image\/jpeg;base64,[a-z0-9+/]+={0,2}$/iu.test(image)) {
    throw new StudyError('現在の用紙の画像を選択してください。');
  }
  const count = Math.min(5, session.questions.length - page * 5);
  try {
    if (!env.AI) throw new Error('Workers AI binding missing');
    const result = await env.AI.run(OCR_MODEL, ocrRequest(image, count));
    return json({ answers: readTranscription(result, count) });
  } catch (error) {
    console.warn('Transcription failed', error.name);
    return json({ error: '文字を自動で読み取れませんでした。補正画像を見ながら入力できます。' }, 502);
  }
}

async function api(request, env, path) {
  const now = new Date();
  const zone = timezone(request);
  if (path === '/api/scan' && request.method === 'POST') return transcribe(request, env);
  if (path === '/api/state' && request.method === 'GET') {
    const { revision, state } = await load(env.DB);
    return json(view(state, now, zone, revision));
  }
  if (path === '/api/cards' && request.method === 'GET') {
    const { state } = await load(env.DB);
    const collection = new URL(request.url).searchParams.get('collection');
    return json(state.cards.filter(card => card.collectionId === collection));
  }
  if (path === '/api/action' && request.method === 'POST') {
    const action = await body(request);
    const { revision, state } = await load(env.DB);
    if (action.revision !== revision) {
      return json({ error: '別の画面で変更がありました。最新の状態を表示しました。', state: view(state, now, zone, revision) }, 409);
    }
    const importResult = applyAction(state, action, now, zone);
    const serialized = JSON.stringify(state);
    if (new TextEncoder().encode(serialized).byteLength > 1_850_000) {
      throw new StudyError('保存容量の上限です。不要な問題を削除してからお試しください。');
    }
    const result = await env.DB.prepare(
      'UPDATE workspace SET state = ?, revision = revision + 1 WHERE id = 1 AND revision = ?',
    ).bind(serialized, revision).run();
    if (!result.meta.changes) {
      const latest = await load(env.DB);
      return json({ error: '別の画面で変更がありました。最新の状態を表示しました。',
        state: view(latest.state, now, zone, latest.revision) }, 409);
    }
    return json({ ...view(state, now, zone, revision + 1), importResult });
  }
  return json({ error: 'ページが見つかりません。' }, 404);
}

export default {
  async fetch(request, env) {
    if (!await authorized(request, env)) {
      return new Response('Cloudflare Access sign-in required.', { status: 403, headers: { 'cache-control': 'no-store' } });
    }
    const path = new URL(request.url).pathname;
    if (!path.startsWith('/api/')) return env.ASSETS.fetch(request);
    try {
      return await api(request, env, path);
    } catch (error) {
      if (error instanceof StudyError) return json({ error: error.message }, 400);
      console.error(error);
      return json({ error: '処理できませんでした。時間をおいてもう一度お試しください。' }, 500);
    }
  },
};
