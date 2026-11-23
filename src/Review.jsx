import { lazy, Suspense, useEffect, useState } from 'react';
import { ArrowLeft, Check, X } from 'lucide-react';
import { Header, ModeChoices } from './ui.jsx';

const PaperReview = lazy(() => import('./PaperReview.jsx'));
const graphemes = Intl.Segmenter ? new Intl.Segmenter('ja', { granularity: 'grapheme' }) : null;
const characters = text => graphemes ? Array.from(graphemes.segment(text), part => part.segment) : Array.from(text);

function difference(answer, expected) {
  const actual = characters(answer);
  const target = characters(expected);
  const limit = Math.min(actual.length, target.length);
  const equal = (left, right) => left.normalize('NFKC').toLowerCase() === right.normalize('NFKC').toLowerCase();
  let start = 0;
  let end = 0;
  while (start < limit && equal(actual[start], target[start])) start++;
  while (start + end < limit && equal(actual[actual.length - 1 - end], target[target.length - 1 - end])) end++;
  return {
    score: start + end,
    actual: [actual.slice(0, start), actual.slice(start, actual.length - end), actual.slice(actual.length - end)],
    target: [target.slice(0, start), target.slice(start, target.length - end), target.slice(target.length - end)],
  };
}

function Highlight({ parts }) {
  return <>{parts[0].join('')}{parts[1].length > 0 && <mark>{parts[1].join('')}</mark>}{parts[2].join('')}</>;
}

function Comparison({ result }) {
  const answer = result.answer.trim();
  const match = !result.correct && answer && result.answers.map(expected => difference(answer, expected))
    .reduce((best, current) => current.score > best.score ? current : best);
  return <dl>
    <div><dt>あなたの解答</dt><dd>{match ? <Highlight parts={match.actual} /> : answer || '未回答'}</dd></div>
    <div><dt>正解</dt><dd>{match ? <Highlight parts={match.target} /> : result.answers[0]}</dd>
      {result.answers.length > 1 && <dd className="variants">許容される解答 {result.answers.join(' / ')}</dd>}</div>
  </dl>;
}

export function Answering({ session, busy, onChoose, send }) {
  const key = `parallel-anki:draft:v1:${session.id}:${session.round}`;
  const [draft, setDraft] = useState(() => {
    try { return JSON.parse(sessionStorage.getItem(key)) ?? { answers: {}, pages: [] }; }
    catch { return { answers: {}, pages: [] }; }
  });
  useEffect(() => {
    try { sessionStorage.setItem(key, JSON.stringify(draft)); }
    catch { /* Storage can be disabled on shared devices. */ }
  }, [draft, key]);

  const submit = async event => {
    event.preventDefault();
    const next = await send({ type: 'submit', sessionId: session.id, round: session.round, answers: draft.answers });
    if (next) {
      try { sessionStorage.removeItem(key); }
      catch { /* The submitted answers are stored on the server. */ }
      window.scrollTo(0, 0);
    }
  };
  const answered = session.questions.filter(q => draft.answers[q.id]?.trim()).length;
  const paper = session.mode === 'paper';
  const heading = <>
    <a href="#today" className="back text-button"><ArrowLeft size={17} /> 今日の復習</a>
    <Header title={`${session.round}周目の復習`} action={<button className="secondary" disabled={busy}
      onClick={() => onChoose(paper ? 'web' : 'paper')}>{paper ? 'Webで解く' : '紙で解く'}</button>}>
      {paper ? `全 ${session.questions.length} 問` : `${answered} / ${session.questions.length} 問 解答済み`}
    </Header>
  </>;
  if (paper) return <Suspense fallback={<>{heading}<p role="status">用紙を準備中…</p></>}>
    <PaperReview session={session} draft={draft} setDraft={setDraft} onSubmit={submit} busy={busy}>{heading}</PaperReview>
  </Suspense>;
  return <>
    {heading}
    <form onSubmit={submit}>
      <ol className="questions">{session.questions.map((question, index) => <li className="panel question" key={question.id}>
        <label>
          <span className="prompt"><span>{index + 1}.</span> {question.prompt}</span>
          <textarea rows="2" maxLength="1000" placeholder="解答を入力" aria-label={`問題 ${index + 1} の解答`}
            value={draft.answers[question.id] ?? ''} onChange={event => {
              const value = event.target.value;
              setDraft(previous => ({ ...previous, answers: { ...previous.answers, [question.id]: value } }));
            }} />
        </label>
      </li>)}</ol>
      <div className="submit-bar"><span>未入力の問題は不正解として採点します。</span><button className="primary" disabled={busy}>採点する</button></div>
    </form>
  </>;
}

export function Results({ session, busy, onChoose, onClose }) {
  const wrong = session.results.filter(result => !result.correct);
  const score = session.results.length - wrong.length;
  return <>
    <a href="#today" className="back text-button"><ArrowLeft size={17} /> 今日の復習</a>
    <Header title={wrong.length ? `${session.round}周目の結果` : '復習が完了しました'}>
      {`${session.results.length}問中 ${score}問正解`}
    </Header>
    <div className="score-track" role="progressbar" aria-label="正解数" aria-valuemax={session.results.length} aria-valuenow={score}>
      <span style={{ width: `${100 * score / session.results.length}%` }} />
    </div>
    <ol className="results">{session.results.map((result, index) => <li key={result.id} className="panel result">
      <span className={result.correct ? 'verdict correct' : 'verdict incorrect'}>
        {result.correct ? <Check size={17} /> : <X size={17} />}{result.correct ? '正解' : '不正解'}</span>
      <h2>{index + 1}. {result.prompt}</h2>
      <Comparison result={result} />
    </li>)}</ol>
    {wrong.length ? <>
      <div className="section-heading"><h2>間違えた {wrong.length} 問を解き直す</h2></div>
      <ModeChoices onChoose={onChoose} disabled={busy} retry />
    </> : <button className="primary" disabled={busy} onClick={onClose}>今日の復習へ戻る</button>}
  </>;
}
