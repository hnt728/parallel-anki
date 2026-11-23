import { useEffect, useMemo, useRef, useState } from 'react';
import { FileUp } from 'lucide-react';
import { MAX_COLLECTION_NAME, MAX_IMPORT_CARDS } from './card-data.js';
import { delimiters, mapTextRows, parseTextFile } from './import-text.js';
import { Notice } from './ui.jsx';

const initialTextOptions = {
  encoding: 'auto', delimiter: 'auto', customDelimiter: '', quote: 'double', header: false,
};
const delimiterLabels = {
  comma: 'カンマ (,)', tab: 'タブ', semicolon: 'セミコロン (;)', pipe: '縦棒 (|)', colon: 'コロン (:)', space: 'スペース',
};
const nameFor = file => file.name.replace(/\.[^.]*$/u, '').trim().slice(0, MAX_COLLECTION_NAME) || 'インポート';

function useFileData(file, anki) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let current = true;
    let worker;
    const maxSize = anki ? 128 : 8;
    if (file.size > maxSize * 1024 * 1024) {
      setError(`ファイルが ${maxSize} MB を超えています。分割して取り込んでください。`);
    } else if (anki) {
      worker = new Worker(new URL('./import-anki.worker.js', import.meta.url), { type: 'module' });
      const finish = () => worker.terminate();
      worker.onmessage = ({ data }) => {
        if (data.error) setError(`Anki ファイルを読み込めませんでした。 ${data.error}`);
        else setData(data.result);
        finish();
      };
      worker.onerror = () => { setError('Anki ファイルを読み込めませんでした。'); finish(); };
      worker.postMessage({ file, name: nameFor(file) });
    } else {
      file.arrayBuffer().then(buffer => { if (current) setData(new Uint8Array(buffer)); })
        .catch(() => { if (current) setError('ファイルを読み込めませんでした。'); });
    }
    return () => { current = false; worker?.terminate(); };
  }, [file, anki]);
  return { data, error };
}

function ColumnSelect({ label, columns, value, onChange, none }) {
  return <label>{label}<select value={value} onChange={event => onChange(Number(event.target.value))}>
    {none && <option value="-1">{none}</option>}
    {columns.map((column, index) => <option key={index} value={index}>{column}</option>)}
  </select></label>;
}

function TextMapping({ parsed, children }) {
  const [prompt, setPrompt] = useState(parsed.defaultPrompt);
  const [answer, setAnswer] = useState(parsed.defaultAnswers[0]);
  const [extras, setExtras] = useState([]);
  const [source, setSource] = useState(parsed.defaultSource);
  const [variants, setVariants] = useState('none');
  const [customVariant, setCustomVariant] = useState('');
  const [html, setHtml] = useState(parsed.html);
  const variantSeparator = { none: '', newline: '\n', pipe: '|', semicolon: ';', custom: customVariant }[variants];
  const options = useMemo(() => mapTextRows(parsed, {
    promptColumn: prompt, answerColumns: [answer, ...extras.filter(index => index !== answer && index !== prompt)],
    sourceColumn: source, variantSeparator, useHtml: html,
  }), [parsed, prompt, answer, extras, source, variantSeparator, html]);
  const issue = answer === prompt ? '問題と正解には異なる列を指定してください。' :
    variants === 'custom' && !customVariant ? '別解の区切り文字を入力してください。' : '';

  return <>
    <div className="import-settings">
      <ColumnSelect label="問題の列" columns={parsed.columns} value={prompt} onChange={setPrompt} />
      <ColumnSelect label="正解の列" columns={parsed.columns} value={answer} onChange={setAnswer} />
    </div>
    <details className="import-details">
      <summary>列と別解の詳細設定</summary>
      <fieldset className="import-choices">
        <legend>別解として使う列</legend>
        <div>{parsed.columns.map((label, index) => index !== answer && index !== prompt && <label key={index}>
          <input type="checkbox" checked={extras.includes(index)} onChange={event => {
            setExtras(event.target.checked ? [...extras, index] : extras.filter(extra => extra !== index));
          }} /> {label}
        </label>)}</div>
        {parsed.columns.length === 2 && <span className="hint">別解はセル内の区切り文字で指定できます。</span>}
      </fieldset>
      <div className="import-settings">
        <label>セル内の別解の区切り<select value={variants} onChange={event => setVariants(event.target.value)}>
          <option value="none">分けない</option><option value="newline">改行</option><option value="pipe">縦棒 (|)</option>
          <option value="semicolon">セミコロン (;)</option><option value="custom">その他</option>
        </select></label>
        {variants === 'custom' && <label>別解の区切り文字<input value={customVariant} maxLength="10" onChange={event => setCustomVariant(event.target.value)} /></label>}
        <ColumnSelect label="コレクション名の列" columns={parsed.columns} value={source} onChange={setSource} none="使わない" />
      </div>
      <label className="import-check"><input type="checkbox" checked={html} onChange={event => setHtml(event.target.checked)} /> HTML をテキストに変換</label>
    </details>
    <Notice>{issue}</Notice>
    {children(options, issue)}
  </>;
}

function TextSettings({ bytes, children }) {
  const [options, setOptions] = useState(initialTextOptions);
  const set = (key, value) => setOptions(previous => ({ ...previous, [key]: value }));
  const { parsed, error } = useMemo(() => {
    try { return { parsed: parseTextFile(bytes, options) }; }
    catch (error) { return { error: error.message }; }
  }, [bytes, options]);
  const detected = parsed && Object.keys(delimiters).find(key => delimiters[key] === parsed.separator);
  return <>
    <div className="import-settings">
      <label>区切り文字<select value={options.delimiter} onChange={event => set('delimiter', event.target.value)}>
        <option value="auto">自動{detected ? ` (${delimiterLabels[detected]})` : ''}</option>
        {Object.entries(delimiterLabels).map(([key, label]) => <option value={key} key={key}>{label}</option>)}
        <option value="custom">その他</option>
      </select></label>
      {options.delimiter === 'custom' && <label>任意の区切り文字<input value={options.customDelimiter}
        maxLength="2" onChange={event => set('customDelimiter', event.target.value)} /></label>}
      <label>文字コード<select value={options.encoding} onChange={event => set('encoding', event.target.value)}>
        <option value="auto">自動</option><option value="utf-8">UTF-8</option><option value="shift_jis">Shift_JIS</option>
        <option value="utf-16le">UTF-16 LE</option><option value="utf-16be">UTF-16 BE</option>
      </select></label>
      <label>引用符<select value={options.quote} onChange={event => set('quote', event.target.value)}>
        <option value="double">二重引用符 (")</option><option value="single">一重引用符 (')</option><option value="none">使わない</option>
      </select></label>
    </div>
    <label className="import-check"><input type="checkbox" checked={options.header} onChange={event => set('header', event.target.checked)} /> 先頭行を列名にする</label>
    <Notice>{error}</Notice>
    {parsed && <TextMapping key={JSON.stringify(options)} parsed={parsed}>
      {(dataset, issue) => children(dataset, issue, parsed.deck)}
    </TextMapping>}
  </>;
}

function Preview({ dataset, collections, collection, defaultName, anki, inputIssue, busy, send, onOpen }) {
  const [choice, setChoice] = useState(collection ? 'existing' : anki ? 'source' : 'new');
  const [collectionId, setCollectionId] = useState(collection?.id ?? collections[0]?.id ?? '');
  const [name, setName] = useState(defaultName);
  const [skipDuplicates, setSkipDuplicates] = useState(true);
  const [result, setResult] = useState(null);
  const status = useRef(null);
  const hasSources = dataset.cards.some(card => card.source);
  const destination = choice === 'source' && !hasSources ? 'new' : choice;
  const tooMany = dataset.cards.length > MAX_IMPORT_CARDS;
  const issue = tooMany ? `一度に取り込めるのは ${MAX_IMPORT_CARDS.toLocaleString()} 件です。ファイルを分割してください。` :
    !dataset.cards.length ? '取り込める問題が見つかりませんでした。' : '';
  const canImport = !result && !inputIssue && !issue && !busy &&
    (destination !== 'existing' || collectionId) && (destination !== 'new' || name.trim());

  async function submit(event) {
    event.preventDefault();
    if (!canImport) return;
    const cards = destination === 'source' ? dataset.cards.map(card => ({ ...card, source: card.source || defaultName })) :
      dataset.cards.map(({ prompt, answers }) => ({ prompt, answers }));
    const response = await send({ type: 'importCards', cards, destination, collectionId, name, skipDuplicates });
    if (response?.importResult) {
      setResult(response.importResult);
      requestAnimationFrame(() => status.current?.focus());
    } else window.scrollTo(0, 0);
  }

  if (result) return <div className="import-result" role="status" tabIndex="-1" ref={status}>
    <h3>{result.added.toLocaleString()} 件取り込みました</h3>
    {result.duplicates > 0 && <p>重複 {result.duplicates.toLocaleString()} 件をスキップしました。</p>}
    {dataset.skipped > 0 && <p>変換できなかった {dataset.skipped.toLocaleString()} 件をスキップしました。</p>}
    {result.collectionIds.length > 0 && <button type="button" className="secondary"
      onClick={() => onOpen(result.collectionIds.length === 1 ? result.collectionIds[0] : null)}>コレクションを開く</button>}
  </div>;

  return <form className="import-preview" onSubmit={submit}>
    <div className="import-settings">
      <label>取り込み先<select value={destination} onChange={event => setChoice(event.target.value)}>
        <option value="new">新しいコレクション</option>
        {!!collections.length && <option value="existing">既存のコレクション</option>}
        {hasSources && <option value="source">{anki ? '元のデッキごと' : '指定の名前ごと'}</option>}
      </select></label>
      {destination === 'existing' && <label>コレクション<select value={collectionId} onChange={event => setCollectionId(event.target.value)}>
        {collections.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select></label>}
      {destination === 'new' && <label>コレクション名<input value={name}
        maxLength={MAX_COLLECTION_NAME} onChange={event => setName(event.target.value)} required /></label>}
    </div>
    {destination === 'source' && <p className="hint">同じ名前のコレクションがある場合は、そこに追加します。</p>}
    <label className="import-check"><input type="checkbox" checked={skipDuplicates}
      onChange={event => setSkipDuplicates(event.target.checked)} /> 同じ問題と正解のカードをスキップ</label>
    <div className="section-heading"><h3>プレビュー</h3>
      <span>{dataset.cards.length.toLocaleString()} 件</span>
    </div>
    {dataset.cards.length > 0 && <div className="table-wrap import-table"><table>
      <thead><tr><th>問題</th><th>正解</th>{destination === 'source' && <th>取り込み先</th>}</tr></thead>
      <tbody>{dataset.cards.slice(0, 5).map((card, index) => <tr key={index}>
        <td>{card.prompt}</td><td>{card.answers.join(' / ')}</td>
        {destination === 'source' && <td>{card.source || defaultName}</td>}
      </tr>)}</tbody>
    </table></div>}
    {dataset.skipped > 0 && <details className="import-details">
      <summary>{dataset.skipped.toLocaleString()} 件をスキップ</summary>
      <ul>{dataset.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul>
    </details>}
    <Notice>{issue}</Notice>
    <div className="actions"><button className="primary" disabled={!canImport}>{busy ? '保存中…' : '取り込む'}</button></div>
  </form>;
}

function FileOptions({ file, collections, collection, busy, send, onOpen }) {
  const anki = /\.(?:apkg|colpkg)$/iu.test(file.name);
  const { data, error } = useFileData(file, anki);
  const preview = (dataset, issue, deck) => <Preview dataset={dataset} collections={collections}
    collection={collection} defaultName={(deck?.trim() || nameFor(file)).slice(0, MAX_COLLECTION_NAME)}
    anki={anki} inputIssue={issue} busy={busy} send={send} onOpen={onOpen} />;
  if (error) return <Notice>{error}</Notice>;
  if (!data) return <p role="status">ファイルを読み込み中…</p>;
  if (anki) return <>
    <p className="hint">問題と正解のテキストを取り込み、新規問題として登録します。</p>
    {preview(data)}
  </>;
  return <TextSettings bytes={data}>{preview}</TextSettings>;
}

export default function ImportPanel({ collections, collection, busy, send, onClose, onOpen }) {
  const [file, setFile] = useState(null);
  const [selection, setSelection] = useState(0);
  return <section className="panel editor import-panel" aria-labelledby="import-title">
    <div className="import-title"><h2 id="import-title">ファイルを取り込む</h2>
      <button className="text-button" type="button" disabled={busy} onClick={onClose}>閉じる</button>
    </div>
    <div className="import-file-row">
      <label className="secondary upload import-file">
        <FileUp size={18} aria-hidden="true" /> ファイルを選ぶ
        <input type="file" accept=".csv,.tsv,.txt,.apkg,.colpkg" aria-label="インポートするファイル" disabled={busy}
          onChange={event => {
            const chosen = event.currentTarget.files?.[0];
            event.currentTarget.value = '';
            if (chosen) { setFile(chosen); setSelection(value => value + 1); }
          }} />
      </label>
      {file ? <p className="import-filename">{file.name}</p> : <p className="hint">CSV・TSV・TXT・Anki パッケージ（APKG・COLPKG）</p>}
    </div>
    {file && <fieldset className="import-content" disabled={busy}>
      <FileOptions key={selection} file={file} collections={collections} collection={collection}
        busy={busy} send={send} onOpen={onOpen} />
    </fieldset>}
  </section>;
}
