import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import { parseAnkiFile } from './import-anki.js';

self.onmessage = async ({ data: { file, name } }) => {
  try {
    const sqlite = await sqlite3InitModule();
    self.postMessage({ result: await parseAnkiFile(file, sqlite, name) });
  } catch (error) {
    self.postMessage({ error: error.message });
  }
};
