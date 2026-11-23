import { ArrowRight } from 'lucide-react';
import { CollectionList } from './Collections.jsx';
import { Header, ModeChoices } from './ui.jsx';

export default function Home({ state, onChoose, onReview, onCollection, busy }) {
  const total = state.review + state.fresh;
  const session = state.session;
  return <>
    <Header title="今日の復習">今日の問題をまとめて解きましょう。</Header>
    <div className="summary">
      <div className="summary-total"><strong>{total}</strong> 問 <span>今日の問題</span></div>
      <div className="summary-breakdown">
        <span>復習 {state.review} <i>·</i> 新規 {state.fresh}</span>
        <div className={total === 0 ? 'meter empty-meter' : 'meter'} aria-hidden="true">
          <div style={{ width: total ? `${state.review * 100 / total}%` : '0%' }} />
        </div>
      </div>
    </div>
    {session ? <section className="resume panel">
      <div><h2>{session.status === 'complete' ? '復習が完了しました' : '進行中の復習'}</h2>
        {session.status !== 'complete' && <p>{session.round}周目 · {session.questions.length}問</p>}</div>
      <button className="primary" onClick={onReview}>{session.status === 'answering' ? '復習を続ける' : '結果を見る'} <ArrowRight size={18} /></button>
    </section> : total ? <ModeChoices onChoose={onChoose} disabled={busy} /> : null}
    <div className="section-heading">
      <h2>コレクション</h2>
      {!!state.collections.length && <a href="#collections" className="text-button">管理する <ArrowRight size={17} /></a>}
    </div>
    <CollectionList collections={state.collections} onSelect={onCollection} onEmpty={() => onCollection('new')} />
  </>;
}
