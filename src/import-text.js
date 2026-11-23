import Papa from 'papaparse';
import { Parser } from 'htmlparser2';
import { cardFieldIssue, MAX_COLLECTION_NAME, MAX_IMPORT_CARDS } from './card-data.js';

export const delimiters = {
  comma: ',', tab: '\t', semicolon: ';', pipe: '|', colon: ':', space: ' ',
};
const encodings = ['auto', 'utf-8', 'shift_jis', 'utf-16le', 'utf-16be'];
const maxRecords = MAX_IMPORT_CARDS * 4;
const ankiHeaders = new Set(['separator', 'html', 'tags', 'columns', 'notetype', 'deck',
  'notetype column', 'deck column', 'tags column', 'guid column']);

export function decodeText(bytes, encoding) {
  if (!encodings.includes(encoding)) throw new Error('文字コードを確認してください。');
  const detected = bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf-16le' :
    bytes[0] === 0xfe && bytes[1] === 0xff ? 'utf-16be' : 'utf-8';
  const decode = name => new TextDecoder(name, { fatal: true }).decode(bytes);
  let text;
  try {
    text = decode(encoding === 'auto' ? detected : encoding);
  } catch {
    if (encoding === 'auto' && detected === 'utf-8' && !(bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf)) {
      try { text = decode('shift_jis'); } catch { /* Show the encoding error below. */ }
    }
  }
  if (text === undefined || text.includes('\0')) throw new Error('文字を読めませんでした。文字コードを指定し直してください。');
  return text;
}

const lineBreaks = new Set(['br', 'div', 'p', 'li', 'ul', 'ol', 'tr', 'table', 'blockquote', 'h1', 'h2', 'h3', 'pre']);
const hiddenTags = new Set(['script', 'style', 'template', 'svg', 'audio', 'video', 'iframe']);

export function plainText(html) {
  const parts = [];
  let hidden = 0;
  const parser = new Parser({
    onopentag(name, attributes) {
      if (hiddenTags.has(name)) hidden++;
      if (hidden) return;
      if (lineBreaks.has(name)) parts.push('\n');
      if (name === 'img' && attributes.alt) parts.push(attributes.alt);
    },
    ontext(text) { if (!hidden) parts.push(text); },
    onclosetag(name) {
      if (hiddenTags.has(name)) hidden--;
      if (hidden) return;
      if (lineBreaks.has(name)) parts.push('\n');
      else if (name === 'td' || name === 'th') parts.push(' ');
    },
  });
  parser.end(html);
  return parts.join('').replace(/\[sound:[^\]]*\]/giu, '').replace(/\u00a0/gu, ' ')
    .replace(/[^\S\n]+\n/gu, '\n').replace(/\n{2,}/gu, '\n').trim();
}

export function answerText(text) {
  return text.trim().replace(/\s*\r?\n\s*/gu, ' ');
}

function extractHeaders(text) {
  const headers = new Map();
  let offset = 0;
  for (const match of text.matchAll(/[^\r\n]+(?:\r\n|\r|\n|$)/gu)) {
    if (offset !== match.index) break;
    const header = /^#\s*([\w ]+):\s*(.*)/u.exec(match[0]);
    const key = header?.[1].trim().toLowerCase();
    if (ankiHeaders.has(key)) headers.set(key, header[2].trim());
    else if (!headers.size || !match[0].startsWith('#')) break;
    offset += match[0].length;
  }
  return { headers, contents: text.slice(offset) };
}

export function parseTextFile(bytes, options) {
  const { headers, contents } = extractHeaders(decodeText(bytes, options.encoding));
  const headerSeparator = headers.get('separator');
  const quoteChar = { double: '"', single: "'", none: '\0' }[options.quote];
  const separator = options.delimiter === 'custom' ? options.customDelimiter :
    options.delimiter === 'auto' ? delimiters[headerSeparator?.toLowerCase()] ?? headerSeparator ?? '' : delimiters[options.delimiter];
  if ((options.delimiter === 'custom' && Array.from(separator).length !== 1) ||
    (separator && (separator === quoteChar || /[\r\n\0"\uFEFF]/u.test(separator)))) {
    throw new Error('区切り文字には、引用符や改行とは異なる1文字を指定してください。');
  }
  const parseOptions = {
    delimiter: separator, quoteChar, escapeChar: quoteChar, skipEmptyLines: 'greedy',
    delimitersToGuess: [',', '\t', ';', '|', ':'], preview: maxRecords + 2,
  };
  const { data, errors, meta } = Papa.parse(contents, parseOptions);
  if (errors.some(error => error.code === 'UndetectableDelimiter')) {
    throw new Error('区切り文字を自動判定できませんでした。ファイルに合う区切り文字を指定してください。');
  }
  if (errors.some(error => error.type === 'Quotes')) {
    const row = errors.find(error => error.type === 'Quotes').row;
    throw new Error(`引用符が閉じていないか、形式が正しくありません（データ行 ${(row ?? 0) + 1}）。`);
  }
  if (data.length > maxRecords) throw new Error('ファイルの行数が多すぎます。分割して取り込んでください。');
  const columnHeader = headers.get('columns');
  const headerRow = options.header && !columnHeader ? data.shift() : null;
  const names = columnHeader ? Papa.parse(columnHeader, { ...parseOptions, delimiter: meta.delimiter }).data[0] : headerRow;
  const width = data.reduce((max, row) => Math.max(max, row.length), names?.length ?? 0);
  if (width < 2 || !data.length) throw new Error('問題と正解の入った2列以上のデータが必要です。区切り文字を確認してください。');
  if (width > 200) throw new Error('200列以下にするか、区切り文字を確認してください。');
  const deckColumn = Number(headers.get('deck column')) - 1;
  const special = ['tags column', 'guid column', 'deck column', 'notetype column'].map(key => Number(headers.get(key)) - 1);
  const contentColumns = Array.from({ length: width }, (_, column) => column).filter(column => !special.includes(column));
  return {
    records: data,
    columns: Array.from({ length: width }, (_, column) => names?.[column]?.trim() || `${column + 1}列目`),
    separator: meta.delimiter,
    html: headers.get('html')?.toLowerCase() === 'true',
    deck: headers.get('deck') ?? '',
    defaultPrompt: contentColumns[0] ?? 0,
    defaultAnswers: [contentColumns[1] ?? 1],
    defaultSource: Number.isInteger(deckColumn) && deckColumn >= 0 && deckColumn < width ? deckColumn : -1,
  };
}

export function mapTextRows(parsed, options) {
  const { promptColumn, answerColumns, sourceColumn, variantSeparator, useHtml } = options;
  const convert = useHtml ? plainText : text => text.trim();
  const warnings = [];
  const cards = [];
  let skipped = 0;
  for (const [index, row] of parsed.records.entries()) {
    const prompt = convert(row[promptColumn] ?? '');
    const answers = [...new Set(answerColumns.flatMap(column => {
      const value = convert(row[column] ?? '');
      return variantSeparator ? value.split(variantSeparator) : [value];
    }).map(answerText).filter(Boolean))];
    const issue = cardFieldIssue(prompt, answers);
    if (issue) {
      skipped++;
      if (warnings.length < 5) warnings.push(`データ行 ${index + 1}。 ${issue}`);
      continue;
    }
    const source = (row[sourceColumn]?.trim() || parsed.deck.trim()).slice(0, MAX_COLLECTION_NAME);
    cards.push({ prompt, answers, ...(source && { source }) });
  }
  return { cards, skipped, warnings };
}
