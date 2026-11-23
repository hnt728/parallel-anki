import { lazy, Suspense, useEffect, useState } from 'react';
import { ArrowLeft, ChevronRight, Download, Pencil, Plus, Trash2 } from 'lucide-react';
import { request } from './api.js';
import { Header, Notice } from './ui.jsx';

const ImportPanel = lazy(() => import('./ImportPanel.jsx'));

export function CollectionList({ collections, onSelect, onEmpty }) {
  if (!collections.length) return <div className="empty">
    <p>コレクションを作って、覚えたい問題を追加しましょう。</p>
    {onEmpty && <button type="button" className="text-button" onClick={onEmpty}>コレクションを作成 <ChevronRight size={16} /></button>}
  </div>;
  return <div className="table-wrap"><table>
    <thead><tr><th>コレクション名</th><th>問題数</th><th>今日</th><th><span className="sr-only">開く</span></th></tr></thead>
    <tbody>{collections.map(collection => <tr key={collection.id}>
      <th scope="row"><button className="row-link" onClick={() => onSelect(collection.id)}>{collection.name}</button></th>
      <td>{collection.count}</td><td>{collection.due}</td><td><ChevronRight size={17} aria-hidden="true" /></td>
    </tr>)}</tbody>
  </table></div>;
}

function CardEditor({ card, onSave, onCancel, busy }) {
  return <form className="panel editor" onSubmit={event => {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    onSave({ prompt: fields.get('prompt'), answers: fields.get('answers') });
  }}>
    <h2>{card ? '問題を編集' : '問題を追加'}</h2>
    <label>問題文<textarea name="prompt" rows="2" maxLength="500" defaultValue={card?.prompt} required autoFocus /></label>
    <label>正解 <span className="hint">別解も採点する場合は、1行に1つ入力</span>
      <textarea name="answers" rows="3" maxLength="3000" defaultValue={card?.answers.join('\n')} required />
    </label>
    <div className="actions"><button className="secondary" type="button" onClick={onCancel}>キャンセル</button>
      <button className="primary" disabled={busy}>保存する</button></div>
  </form>;
}

export default function Collections({ state, selected, onSelect, send, busy }) {
  const collection = state.collections.find(item => item.id === selected);
  const [cards, setCards] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [editor, setEditor] = useState(null);
  const [collectionEditor, setCollectionEditor] = useState(selected === 'new');
  const [importOpen, setImportOpen] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (!collection?.id) return;
    let current = true;
    request(`/api/cards?collection=${encodeURIComponent(collection.id)}`)
      .then(data => { if (current) { setCards(data); setLoadError(''); } })
      .catch(error => { if (current) setLoadError(error.message); });
    return () => { current = false; };
  }, [collection?.id, state.revision, reload]);

  const saveCollection = async event => {
    event.preventDefault();
    const name = new FormData(event.currentTarget).get('name');
    const next = await send({ type: 'saveCollection', id: collection?.id, name });
    if (next) {
      setCollectionEditor(false);
      if (!collection) onSelect(next.collections.at(-1).id);
    }
  };

  return <>
    {collection && <button className="back text-button" onClick={() => onSelect(null)}><ArrowLeft size={17} /> コレクション</button>}
    <Header title={collection?.name ?? 'コレクション'} action={!collectionEditor && !editor && !importOpen &&
      <div className="collection-actions">
        <button className="secondary" disabled={busy} onClick={() => setImportOpen(true)}>
          <Download size={18} aria-hidden="true" /> インポート
        </button>
        <button className="primary" disabled={busy} onClick={() => collection ? setEditor('new') : setCollectionEditor(true)}>
          <Plus size={19} aria-hidden="true" /> {collection ? '問題を追加' : '新規コレクション'}
        </button>
      </div>} />
    {collection && <div className="collection-tools">
      <button className="text-button" disabled={importOpen || busy} onClick={() => setCollectionEditor(true)}><Pencil size={16} /> 名前を変更</button>
      <button className="text-button danger" disabled={importOpen || busy} onClick={async () => {
        if (confirm(`「${collection.name}」と、その問題をすべて削除しますか？`) &&
          await send({ type: 'deleteCollection', id: collection.id })) onSelect(null);
      }}><Trash2 size={16} /> コレクションを削除</button>
    </div>}
    {collectionEditor && <form className="panel editor" onSubmit={saveCollection}>
      <h2>{collection ? '名前を変更' : '新規コレクション'}</h2>
      <label>コレクション名<input name="name" maxLength="80" defaultValue={collection?.name} required autoFocus /></label>
      <div className="actions">
        <button className="secondary" type="button" onClick={() => selected === 'new' ? onSelect(null) : setCollectionEditor(false)}>
          キャンセル
        </button>
        <button className="primary" disabled={busy}>保存する</button>
      </div>
    </form>}
    {importOpen && <Suspense fallback={<p role="status">インポート画面を開いています…</p>}>
      <ImportPanel collections={state.collections} collection={collection} busy={busy} send={send}
        onClose={() => setImportOpen(false)} onOpen={id => { setImportOpen(false); onSelect(id); }} />
    </Suspense>}
    {!collection && !importOpen && (!collectionEditor || state.collections.length > 0) &&
      <CollectionList collections={state.collections} onSelect={onSelect} />}
    {collection && editor && <CardEditor key={editor} card={cards?.find(card => card.id === editor)} busy={busy}
      onCancel={() => setEditor(null)} onSave={async values => {
        if (await send({ type: 'saveCard', id: editor === 'new' ? undefined : editor, collectionId: collection.id, ...values })) setEditor(null);
      }} />}
    {collection && !importOpen && <>
      <Notice>{loadError}</Notice>
      {loadError && <button className="secondary" onClick={() => setReload(value => value + 1)}>再読み込み</button>}
      {!cards && !loadError && <p role="status">読み込み中…</p>}
      {cards?.length === 0 && <div className="empty">問題を追加すると、今日の復習に表示されます。</div>}
      {!!cards?.length && <ul className="card-list">{cards.map(card => <li key={card.id}>
        <div><strong>{card.prompt}</strong><p>{card.answers.join(' / ')}</p>
          {card.schedule && <small>次回 {new Date(card.schedule.due).toLocaleDateString('ja-JP')}</small>}</div>
        <div className="card-buttons">
          <button className="icon-button" aria-label="問題を編集" disabled={importOpen || busy} onClick={() => setEditor(card.id)}><Pencil size={18} /></button>
          <button className="icon-button danger" aria-label="問題を削除" disabled={importOpen || busy} onClick={async () => {
            if (confirm('この問題を削除しますか？') && await send({ type: 'deleteCard', id: card.id })) {
              if (editor === card.id) setEditor(null);
            }
          }}><Trash2 size={18} /></button>
        </div>
      </li>)}</ul>}
    </>}
  </>;
}
