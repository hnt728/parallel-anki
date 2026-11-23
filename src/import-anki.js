import { BlobReader, ZipReader } from '@zip.js/zip.js';
import { Decompress } from 'fzstd';
import { cardFieldIssue, MAX_COLLECTION_NAME, MAX_IMPORT_CARDS } from './card-data.js';
import { answerText, plainText } from './import-text.js';

const databaseLimit = 40 * 1024 * 1024;
const maxRecords = MAX_IMPORT_CARDS * 4;
const databaseNames = ['collection.anki21b', 'collection.anki21', 'collection.anki2'];
const sizeError = () => new Error('APKG 内のデータベースが40 MBを超えています。Ankiでデッキを分けて書き出してください。');

function collectionBytes(entry) {
  if (entry.uncompressedSize > databaseLimit) throw sizeError();
  const output = new Uint8Array(entry.uncompressedSize);
  let length = 0;
  const writer = new WritableStream({
    write(chunk) {
      if (length + chunk.length > output.length) throw sizeError();
      output.set(chunk, length);
      length += chunk.length;
    },
  });
  return entry.getData(writer, { checkSignature: true }).then(() => {
    if (length !== output.length) throw new Error('APKG のデータベースが破損しています。');
    return output;
  });
}

// Anki writes one Zstandard frame. Check its window and block lengths before allocating a decoder.
function validateZstdFrame(bytes) {
  const invalid = () => new Error('APKG の圧縮データを読み込めませんでした。');
  if (bytes.length < 8 || bytes[0] !== 0x28 || bytes[1] !== 0xb5 || bytes[2] !== 0x2f || bytes[3] !== 0xfd) {
    throw invalid();
  }
  const flags = bytes[4];
  const single = Boolean(flags & 32);
  const dictionaryBytes = [0, 1, 2, 4][flags & 3];
  const sizeCode = flags >> 6;
  const sizeBytes = [single ? 1 : 0, 2, 4, 8][sizeCode];
  let offset = (single ? 5 : 6) + dictionaryBytes;
  if (offset + sizeBytes > bytes.length) throw invalid();
  let size = sizeCode === 1 ? 256n : 0n;
  for (let index = 0; index < sizeBytes; index++) size += BigInt(bytes[offset + index]) << BigInt(index * 8);
  const baseWindow = 2 ** (10 + (bytes[5] >> 3));
  const window = single ? Number(size) : baseWindow * (1 + (bytes[5] & 7) / 8);
  if (window > databaseLimit || size > BigInt(databaseLimit)) throw sizeError();
  offset += sizeBytes;
  let last;
  do {
    if (offset + 3 > bytes.length) throw invalid();
    const block = bytes[offset] + bytes[offset + 1] * 256 + bytes[offset + 2] * 65536;
    const kind = (block >> 1) & 3;
    if (kind === 3) throw invalid();
    offset += 3 + (kind === 1 ? 1 : block >> 3);
    last = block & 1;
  } while (!last);
  if (offset + (flags & 4 ? 4 : 0) !== bytes.length) throw invalid();
}

function unzipZstd(bytes) {
  validateZstdFrame(bytes);
  const chunks = [];
  let length = 0;
  const stream = new Decompress(chunk => {
    length += chunk.length;
    if (length > databaseLimit) throw sizeError();
    chunks.push(chunk);
  });
  stream.push(bytes, true);
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

async function openDatabase(file) {
  const zip = new ZipReader(new BlobReader(file), { useWebWorkers: false });
  try {
    const entries = new Map();
    for await (const entry of zip.getEntriesGenerator()) {
      if (!entry.directory && databaseNames.includes(entry.filename)) entries.set(entry.filename, entry);
    }
    const name = databaseNames.find(candidate => entries.has(candidate));
    if (!name) throw new Error('APKG 内に Anki のデータベースがありません。');
    const bytes = await collectionBytes(entries.get(name));
    return name === 'collection.anki21b' ? unzipZstd(bytes) : bytes;
  } finally {
    await zip.close();
  }
}

// The modern SQLite schema stores the question and answer template strings as
// protobuf fields 1 and 2 in each template's config.
function templateFormats(bytes) {
  const formats = [];
  const decoder = new TextDecoder();
  let offset = 0;
  function varint() {
    let value = 0n;
    for (let shift = 0n; shift < 70n && offset < bytes.length; shift += 7n) {
      const byte = bytes[offset++];
      value |= BigInt(byte & 127) << shift;
      if (byte < 128) return Number(value);
    }
    throw new Error('Anki のテンプレートが破損しています。');
  }
  while (offset < bytes.length) {
    const key = varint();
    const wire = key & 7;
    const field = key >>> 3;
    if (wire === 2) {
      const size = varint();
      if (offset + size > bytes.length) break;
      if (field === 1 || field === 2) formats[field - 1] = decoder.decode(bytes.subarray(offset, offset + size));
      offset += size;
    } else if (wire === 0) varint();
    else if (wire === 1 || wire === 5) offset += wire === 1 ? 8 : 4;
    else break;
  }
  return formats;
}

function metadata(db, tables) {
  const decks = new Map();
  const types = new Map();
  if (tables.has('decks') && tables.has('fields')) {
    for (const [id, name] of db.selectArrays('SELECT CAST(id AS TEXT), name FROM decks NOT INDEXED')) {
      decks.set(id, name.replaceAll('\x1f', '::'));
    }
    for (const [id, index, name] of db.selectArrays('SELECT CAST(ntid AS TEXT), ord, name FROM fields')) {
      if (!types.has(id)) types.set(id, { names: [], templates: [] });
      types.get(id).names[index] = name;
    }
    if (tables.has('templates')) {
      for (const [id, index, config] of db.selectArrays('SELECT CAST(ntid AS TEXT), ord, config FROM templates')) {
        const type = types.get(id);
        if (type) type.templates[index] = templateFormats(config);
      }
    }
  } else {
    const [deckJson, typeJson] = db.selectArrays('SELECT decks, models FROM col LIMIT 1')[0] ?? ['{}', '{}'];
    for (const [id, deck] of Object.entries(JSON.parse(deckJson))) decks.set(id, deck.name);
    for (const [id, type] of Object.entries(JSON.parse(typeJson))) {
      types.set(id, {
        names: (type.flds ?? []).map(field => field.name),
        templates: (type.tmpls ?? []).map(template => [template.qfmt, template.afmt]),
      });
    }
  }
  return { decks, types };
}

function clozeCard(text, ordinal) {
  if (!/\{\{c\d+::/iu.test(text)) return null;
  const root = { body: [] };
  const stack = [root];
  let offset = 0;
  let found = false;
  const append = item => {
    const current = stack.at(-1);
    (current.inHint ? current.hint : current.body).push(item);
  };
  for (const match of text.matchAll(/\{\{c(\d+)::|::|\}\}/giu)) {
    append(text.slice(offset, match.index));
    offset = match.index + match[0].length;
    if (match[1] !== undefined) {
      if (stack.length > 20) return { prompt: '', answers: [] };
      stack.push({ number: Number(match[1]), body: [], hint: [] });
    } else if (stack.length > 1 && match[0] === '}}') {
      append(stack.pop());
      found = true;
    } else if (stack.length > 1 && !stack.at(-1).inHint && match[0] === '::') {
      stack.at(-1).inHint = true;
    } else append(match[0]);
  }
  if (!found || stack.length !== 1) return null;
  append(text.slice(offset));
  const answers = [];
  function render(parts, hide) {
    return parts.map(part => {
      if (typeof part === 'string') return part;
      if (!hide || part.number !== ordinal + 1) return render(part.body, hide);
      answers.push(answerText(render(part.body, false)));
      return `［${render(part.hint, false) || '…'}］`;
    }).join('');
  }
  const prompt = render(root.body, true);
  return { prompt, answers: answers.length && answers.every(Boolean) ? [[...new Set(answers)].join(', ')] : [] };
}

const frontName = /^(?:front|question|表面|問題|問題文|表)$/iu;
const backName = /^(?:back|answer|裏面|正解|解答|回答|裏)$/iu;

function templateFields(format, names) {
  return [...(format ?? '').matchAll(/\{\{\s*([^{}#!\/^]+?)\s*\}\}/gu)].flatMap(([, reference]) => {
    const filters = reference.split(':').map(part => part.trim());
    const index = names.indexOf(filters.at(-1));
    return index < 0 ? [] : [{ index, typed: filters.slice(0, -1).includes('type') }];
  });
}

function noteCard(values, type, ordinal) {
  const fields = values.split('\x1f').map(plainText);
  let hasCloze = false;
  for (const field of fields) {
    const cloze = clozeCard(field, ordinal);
    if (cloze?.answers.length) return cloze;
    if (cloze) hasCloze = true;
  }
  if (hasCloze) return { prompt: '', answers: [] };
  const names = type?.names ?? [];
  const front = names.findIndex(name => name && frontName.test(name));
  const back = names.findIndex(name => name && backName.test(name));
  const template = type?.templates[ordinal];
  if (template?.[0]) {
    const question = templateFields(template[0], names);
    const visible = [...new Set(question.filter(field => !field.typed).map(field => field.index))];
    const answer = question.find(field => field.typed)?.index ??
      templateFields(template[1], names).find(field => !visible.includes(field.index) && fields[field.index])?.index;
    if (visible.length && answer !== undefined) {
      return { prompt: visible.map(index => fields[index]).filter(Boolean).join('\n'), answers: [answerText(fields[answer] ?? '')] };
    }
  }
  const question = fields[front === -1 ? 0 : front] ?? '';
  const answer = fields[back === -1 ? 1 : back] ?? '';
  if (ordinal === 0) return { prompt: question, answers: [answerText(answer)] };
  if (ordinal === 1) return { prompt: answer, answers: [answerText(question)] };
  return { prompt: '', answers: [] };
}

export async function parseAnkiFile(file, sqlite, defaultName) {
  const bytes = await openDatabase(file);
  if (bytes.length < 100 || new TextDecoder().decode(bytes.subarray(0, 16)) !== 'SQLite format 3\0') {
    throw new Error('APKG 内の SQLite ファイルが破損しています。');
  }
  // Anki embeds a standalone database. In-memory SQLite needs rollback-mode header bytes.
  if (bytes[18] === 2 && bytes[19] === 2) bytes[18] = bytes[19] = 1;
  const { capi, wasm, oo1 } = sqlite;
  const db = new oo1.DB(':memory:', 'c');
  try {
    const capacity = bytes.length + 20;
    const buffer = capi.sqlite3_malloc(capacity);
    if (!buffer) throw sizeError();
    const heap = wasm.heap8u();
    heap.set(bytes, buffer);
    heap.fill(0, buffer + bytes.length, buffer + capacity);
    db.checkRc(capi.sqlite3_deserialize(db.pointer, 'main', buffer, bytes.length, capacity,
      capi.SQLITE_DESERIALIZE_FREEONCLOSE | capi.SQLITE_DESERIALIZE_READONLY));
    const decoder = new TextDecoder();
    const collator = new Intl.Collator('und', { sensitivity: 'accent' });
    // Anki declares "unicase" on names. Queries do not look up or sort these names in Anki's indexes.
    db.checkRc(capi.sqlite3_create_collation_v2(db.pointer, 'unicase', capi.SQLITE_UTF8, 0, (_, n1, p1, n2, p2) => {
      const heap = wasm.heap8u();
      return collator.compare(decoder.decode(heap.subarray(p1, p1 + n1)), decoder.decode(heap.subarray(p2, p2 + n2)));
    }, 0));
    db.exec('PRAGMA trusted_schema=OFF; PRAGMA query_only=ON');
    const tables = new Set(db.selectArrays("SELECT name FROM sqlite_schema WHERE type = 'table'").flat());
    if (!['notes', 'cards', 'col'].every(table => tables.has(table))) {
      throw new Error('Anki のカードとノートを読み込めませんでした。');
    }
    const { decks, types } = metadata(db, tables);
    const rows = db.selectArrays(`SELECT CAST(c.id AS TEXT), CAST(CASE WHEN c.odid != 0 THEN c.odid ELSE c.did END AS TEXT),
      c.ord, CAST(n.mid AS TEXT), n.flds
      FROM cards c JOIN notes n ON c.nid = n.id ORDER BY c.id LIMIT ${maxRecords + 1}`);
    if (rows.length > maxRecords) throw new Error('APKG のカード数が多すぎます。デッキを分割してください。');
    const cards = [];
    const warnings = [];
    let skipped = 0;
    for (const [id, deckId, ordinal, typeId, fields] of rows) {
      const source = (decks.get(deckId)?.trim() || defaultName).slice(0, MAX_COLLECTION_NAME);
      const { prompt, answers } = noteCard(fields, types.get(typeId), ordinal);
      if (cardFieldIssue(prompt, answers)) {
        skipped++;
        if (warnings.length < 5) warnings.push(`${source} のカード ${id} から問題と正解を取り出せませんでした。`);
        continue;
      }
      cards.push({ prompt, answers, source });
    }
    return { cards, skipped, warnings };
  } finally {
    db.close();
  }
}
