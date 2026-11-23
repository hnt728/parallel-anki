import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Copy } from 'lucide-react';
import { request } from './api.js';
import Home from './Home.jsx';
import Collections from './Collections.jsx';
import { Answering, Results } from './Review.jsx';
import { Notice } from './ui.jsx';
import './style.css';

function App() {
  const [route, setRoute] = useState(window.location.hash);
  const [state, setState] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const syncRoute = () => {
      setRoute(window.location.hash);
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', syncRoute);
    return () => window.removeEventListener('hashchange', syncRoute);
  }, []);

  useEffect(() => {
    let current = true;
    request('/api/state').then(value => { if (current) { setState(value); setError(''); } })
      .catch(failure => { if (current) setError(failure.message); });
    return () => { current = false; };
  }, [attempt]);

  const collections = route.startsWith('#collections');
  const selected = collections ? route.split('/')[1] ?? null : null;
  const onCollection = id => { window.location.hash = id ? `collections/${id}` : 'collections'; };
  const review = route === '#review' && state?.session;
  const send = async action => {
    if (busy) return null;
    setBusy(true);
    setError('');
    try {
      const next = await request('/api/action', { ...action, revision: state.revision });
      setState(next);
      return next;
    } catch (failure) {
      if (failure.state) setState(failure.state);
      setError(failure.message);
      return null;
    } finally { setBusy(false); }
  };
  const onChoose = async mode => {
    const active = state.session?.status !== 'complete' ? state.session : null;
    if (await send({ type: 'start', mode, sessionId: active?.id, round: active?.round })) {
      window.location.hash = 'review';
      window.scrollTo(0, 0);
    }
  };
  const onClose = async () => {
    if (await send({ type: 'close', sessionId: state.session.id })) window.location.hash = 'today';
  };

  return <>
    <header className="site-header"><div className="site-inner">
      <a href="#today" className="brand"><Copy size={25} strokeWidth={1.8} aria-hidden="true" /> Parallel Anki</a>
      <nav aria-label="メインメニュー">
        <a href="#today" aria-current={!collections ? 'page' : undefined}>今日の復習</a>
        <a href="#collections" aria-current={collections ? 'page' : undefined}>コレクション</a>
      </nav>
    </div></header>
    <main>
      <Notice>{error}</Notice>
      {!state ? (error ? <button className="secondary" onClick={() => setAttempt(attempt + 1)}>再読み込み</button> :
        <p role="status">読み込み中…</p>) : collections ?
          <Collections key={selected ?? 'list'} state={state} selected={selected} onSelect={onCollection} send={send} busy={busy} /> :
        review ? (review.status === 'answering' ?
          <Answering key={`${review.id}:${review.round}`} session={review} send={send} onChoose={onChoose} busy={busy} /> :
          <Results session={review} onChoose={onChoose} onClose={onClose} busy={busy} />) :
        <Home state={state} onChoose={onChoose} onReview={() => { window.location.hash = 'review'; }} onCollection={onCollection} busy={busy} />}
    </main>
  </>;
}

createRoot(document.getElementById('root')).render(<App />);
