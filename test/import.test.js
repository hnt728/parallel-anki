import test from 'node:test';
import assert from 'node:assert/strict';
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import { BlobWriter, Uint8ArrayReader, ZipWriter } from '@zip.js/zip.js';
import { parseAnkiFile } from '../src/import-anki.js';
import { mapTextRows, parseTextFile } from '../src/import-text.js';
import { applyAction } from '../src/study.js';

const encoder = new TextEncoder();
const defaults = { encoding: 'auto', delimiter: 'auto', quote: 'double', header: false };

test('text import respects quoted separators, multiline fields, metadata and answer mapping', () => {
  const bytes = encoder.encode('#separator:Pipe\r\n#columns:deck|question|answer|variant\r\n#deck column:1\r\n#html:true\r\n' +
    'Vocabulary|"A|B<br>と書く"|"a\r\nb"|"<b>other</b>"\r\nVocabulary|空欄||\r\n');
  const parsed = parseTextFile(bytes, defaults);
  assert.deepEqual(parsed.columns, ['deck', 'question', 'answer', 'variant']);
  assert.equal(parsed.defaultSource, 0);
  assert.equal(parsed.defaultPrompt, 1);
  assert.deepEqual(parsed.defaultAnswers, [2]);
  assert.deepEqual(parsed.records[0], ['Vocabulary', 'A|B<br>と書く', 'a\r\nb', '<b>other</b>']);
  const { cards, skipped } = mapTextRows(parsed, {
    promptColumn: 1, answerColumns: [2, 3], sourceColumn: 0, variantSeparator: '\n', useHtml: parsed.html,
  });
  assert.equal(skipped, 1);
  assert.deepEqual(cards, [{ prompt: 'A|B\nと書く', answers: ['a', 'b', 'other'], source: 'Vocabulary' }]);
  assert.throws(() => parseTextFile(encoder.encode('q,"unclosed\n'), defaults), /引用符/u);
  assert.deepEqual(parseTextFile(encoder.encode('#word: question,answer'), defaults).records, [['#word: question', 'answer']]);
});

test('bulk import validates every card before writing and preserves duplicate schedules', () => {
  const schedule = { due: '2027-02-01T00:00:00.000Z' };
  const state = {
    collections: [{ id: 'original', name: 'Vocabulary' }],
    cards: [{ id: 'existing', collectionId: 'original', prompt: 'DOG', answers: ['dog'], schedule }], session: null,
  };
  const action = { type: 'importCards', destination: 'source', skipDuplicates: true, cards: [
    { prompt: 'dog', answers: ['ＤＯＧ'], source: 'Vocabulary' },
    { prompt: 'bird', answers: ['鳥'], source: 'Other' },
    { prompt: 'ＢＩＲＤ', answers: [' 鳥 '], source: 'Other' },
  ] };
  assert.throws(() => applyAction(state, { ...action, cards: [...action.cards, { prompt: '', answers: [] }] }));
  assert.equal(state.collections.length, 1);
  assert.equal(state.cards.length, 1);
  const result = applyAction(state, action);
  assert.deepEqual(result, { added: 1, duplicates: 2, collectionIds: ['original', state.collections[1].id] });
  assert.strictEqual(state.cards[0].schedule, schedule);
  assert.equal(state.cards[1].schedule, null);
});

function zstdRawFrame(bytes) {
  // A single raw last block is enough for this small SQLite fixture.
  const block = bytes.length * 8 + 1;
  const frame = new Uint8Array(bytes.length + 12);
  frame.set([0x28, 0xb5, 0x2f, 0xfd, 0xa0]);
  new DataView(frame.buffer).setUint32(5, bytes.length, true);
  frame.set([block & 255, (block >> 8) & 255, block >> 16], 9);
  frame.set(bytes, 12);
  return frame;
}

test('modern APKG handles an Anki collation, WAL header, reverse cards and nested clozes', async () => {
  const sqlite = await sqlite3InitModule();
  const db = new sqlite.oo1.DB(':memory:', 'c');
  let bytes;
  try {
    db.checkRc(sqlite.capi.sqlite3_create_collation_v2(db.pointer, 'unicase', sqlite.capi.SQLITE_UTF8, 0, () => 0, 0));
    db.exec(`
      CREATE TABLE col (id INTEGER PRIMARY KEY);
      CREATE TABLE decks (id INTEGER PRIMARY KEY, name TEXT COLLATE unicase);
      INSERT INTO decks VALUES (101,'語彙' || char(31) || '基本');
      CREATE TABLE fields (ntid INTEGER, ord INTEGER, name TEXT COLLATE unicase, PRIMARY KEY (ntid,ord)) WITHOUT ROWID;
      INSERT INTO fields VALUES (1,0,'Front'), (1,1,'Back');
      CREATE TABLE notes (id INTEGER PRIMARY KEY, mid INTEGER, flds TEXT);
      INSERT INTO notes VALUES (21,1,'<b>犬</b>' || char(31) || 'dog');
      INSERT INTO notes VALUES (22,2,'{{c1::Founded in {{c2::1913}}}}.');
      CREATE TABLE cards (id INTEGER PRIMARY KEY, nid INTEGER, did INTEGER, ord INTEGER, odid INTEGER);
      INSERT INTO cards VALUES (11,21,101,0,0), (12,21,101,1,0), (13,22,101,1,0);
    `);
    bytes = sqlite.capi.sqlite3_js_db_export(db.pointer);
  } finally {
    db.close();
  }
  bytes[18] = bytes[19] = 2;
  const zip = new ZipWriter(new BlobWriter(), { useWebWorkers: false });
  await zip.add('collection.anki2', new Uint8ArrayReader(encoder.encode('old-client placeholder')));
  await zip.add('collection.anki21b', new Uint8ArrayReader(zstdRawFrame(bytes)));
  const result = await parseAnkiFile(await zip.close(), sqlite, 'import');
  assert.deepEqual(result.cards, [
    { prompt: '犬', answers: ['dog'], source: '語彙::基本' },
    { prompt: 'dog', answers: ['犬'], source: '語彙::基本' },
    { prompt: 'Founded in ［…］.', answers: ['1913'], source: '語彙::基本' },
  ]);
});
