import { useEffect, useRef, useState } from 'react';
import { Camera, Check, ExternalLink, ImagePlus } from 'lucide-react';
import { PAGE_SIZE, scanSheet, worksheet } from './paper.js';
import { request } from './api.js';
import { Notice } from './ui.jsx';

export default function PaperReview({ session, draft, setDraft, onSubmit, busy, children }) {
  const [pdf, setPdf] = useState('');
  const [error, setError] = useState('');
  const [scanning, setScanning] = useState(false);
  const [previews, setPreviews] = useState({});
  const [readWarnings, setReadWarnings] = useState([]);
  const scan = useRef(null);
  const pages = Math.ceil(session.questions.length / PAGE_SIZE);
  const scannable = draft.pages.length === pages;
  useEffect(() => () => scan.current?.abort(), []);
  useEffect(() => {
    let disposed = false;
    let url;
    worksheet(session).then(blob => {
      if (!disposed) {
        url = URL.createObjectURL(blob);
        setPdf(url);
      }
    }).catch(() => { if (!disposed) setError('PDFを作成できませんでした。ページを読み直してください。'); });
    return () => { disposed = true; if (url) URL.revokeObjectURL(url); };
  }, [session.id, session.round, session.questions]);

  async function readFiles(event) {
    const files = [...event.currentTarget.files];
    event.currentTarget.value = '';
    if (!files.length) return;
    const controller = new AbortController();
    scan.current = controller;
    setScanning(true);
    setError('');
    const failures = [];
    for (const file of files) {
      try {
        const { page, image, previews: pagePreviews } = await scanSheet(file, session);
        if (controller.signal.aborted) return;
        const pageQuestions = session.questions.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
        setPreviews(previous => ({ ...previous, ...Object.fromEntries(pageQuestions.map((q, i) => [q.id, pagePreviews[i]])) }));
        try {
          const { answers } = await request('/api/scan', { sessionId: session.id, round: session.round, page, image }, controller.signal);
          if (controller.signal.aborted) return;
          setDraft(previous => ({
            answers: { ...previous.answers, ...Object.fromEntries(pageQuestions.map((q, i) => [q.id, answers[i]])) },
            pages: [...new Set([...previous.pages, page])],
          }));
          setReadWarnings(previous => previous.filter(index => index !== page));
        } catch {
          if (controller.signal.aborted) return;
          setReadWarnings(previous => [...new Set([...previous, page])]);
          setDraft(previous => ({ ...previous, pages: [...new Set([...previous.pages, page])] }));
        }
      } catch (failure) {
        if (controller.signal.aborted) return;
        failures.push(`${file.name} — ${failure.message}`);
      }
    }
    scan.current = null;
    setError(failures.join('\n'));
    setScanning(false);
  }

  return <>
    {children}
    <section className="panel paper-step">
      <div><h2>問題用紙を印刷</h2><p>A4で印刷し、枠の中に解答を書いてください。</p></div>
      {pdf ? <a href={pdf} target="_blank" rel="noreferrer" className="secondary">PDFを開く <ExternalLink size={17} /></a> :
        <span role="status">{error ? 'PDFを表示できません' : 'PDFを作成中…'}</span>}
      {pdf && <object className="worksheet-preview" data={pdf} type="application/pdf" aria-label="問題用紙のPDF">
        上のボタンから問題用紙を開けます。
      </object>}
    </section>
    <section className="panel paper-step">
      <div><h2>用紙を読み込む</h2><p>四隅のマーカーが入るよう、明るい場所で1枚ずつ撮影してください。</p></div>
      <div className="upload-actions">
        <label className="primary upload"><Camera size={18} /> 撮影する
          <input type="file" accept="image/*" capture="environment" disabled={scanning || busy} onChange={readFiles} aria-label="撮影する" /></label>
        <label className="secondary upload"><ImagePlus size={18} /> 画像を選ぶ
          <input type="file" accept="image/*" multiple disabled={scanning || busy} onChange={readFiles} aria-label="画像を選ぶ" /></label>
      </div>
      <p className="scan-count" role="status">{scanning ? '用紙を読み込み中…' : `${draft.pages.length} / ${pages} ページ読み込み済み`}</p>
      <ul className="page-list" aria-label="ページの読み込み状況">
        {Array.from({ length: pages }, (_, page) => <li key={page} className={draft.pages.includes(page) ? 'read' : ''}>
          {draft.pages.includes(page) && <Check size={14} aria-hidden="true" />}{page + 1}ページ
        </li>)}
      </ul>
      <Notice>{error}</Notice>
      <Notice>{readWarnings.length ? `${readWarnings.map(page => page + 1).join('、')}ページの文字を自動で読み取れませんでした。補正画像を見ながら入力してください。` : ''}</Notice>
    </section>
    {draft.pages.length > 0 && <form onSubmit={onSubmit}>
      <div className="section-heading"><h2>読み取り結果を確認</h2></div>
      <p className="review-hint">画像と見比べて、読み間違いがあれば修正してください。</p>
      <div className="paper-answers">
        {session.questions.map((q, index) => draft.pages.includes(Math.floor(index / PAGE_SIZE)) && <label key={q.id} className="panel question">
          <span className="prompt"><span>{index + 1}.</span> {q.prompt}</span>
          {previews[q.id] && <img src={previews[q.id]} alt={`問題 ${index + 1} の筆記解答`} width="929" height="108" />}
          <textarea maxLength="1000" rows="2" disabled={scanning} aria-label={`問題 ${index + 1} の解答`} placeholder="解答を入力"
            value={draft.answers[q.id] ?? ''} onChange={event => {
              const value = event.target.value;
              setDraft(previous => ({ ...previous, answers: { ...previous.answers, [q.id]: value } }));
            }} />
        </label>)}
      </div>
      <div className="submit-bar">
        {!scannable && <span>全ページを読み込むと採点できます。</span>}
        <button className="primary" disabled={!scannable || scanning || busy}>採点する</button>
      </div>
    </form>}
  </>;
}
