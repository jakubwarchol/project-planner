import initSqlJs, { type Database } from "sql.js";
import wasmUrl from "sql.js/dist/sql-wasm.wasm?url";
import { MIGRATIONS } from "./migrations";

// sql.js keeps the database in memory, so persistence means writing the whole
// file back to IndexedDB after a change. At this size (kilobytes) that is
// cheap; the debounce keeps a burst of edits down to one write.
const IDB_NAME = "project-planner-sqlite";
const IDB_STORE = "files";
const IDB_KEY = "planner.sqlite";
const SAVE_DEBOUNCE_MS = 200;

let dbPromise: Promise<Database> | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

function openIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(IDB_NAME, 1);
    request.onupgradeneeded = () => {
      const idb = request.result;
      if (!idb.objectStoreNames.contains(IDB_STORE)) idb.createObjectStore(IDB_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readFile(): Promise<Uint8Array | null> {
  const idb = await openIdb();
  return new Promise((resolve, reject) => {
    const tx = idb.transaction(IDB_STORE, "readonly");
    const request = tx.objectStore(IDB_STORE).get(IDB_KEY);
    request.onsuccess = () => resolve((request.result as Uint8Array) ?? null);
    request.onerror = () => reject(request.error);
  });
}

async function writeFile(bytes: Uint8Array): Promise<void> {
  const idb = await openIdb();
  return new Promise((resolve, reject) => {
    const tx = idb.transaction(IDB_STORE, "readwrite");
    tx.objectStore(IDB_STORE).put(bytes, IDB_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// Bring an existing (or brand new) database up to the latest schema version,
// each step in its own transaction so a failure leaves the version behind.
function migrate(db: Database): void {
  const [row] = db.exec("PRAGMA user_version");
  const current = Number(row?.values?.[0]?.[0] ?? 0);

  for (let version = current; version < MIGRATIONS.length; version++) {
    db.exec("BEGIN");
    try {
      db.exec(MIGRATIONS[version]);
      db.exec(`PRAGMA user_version = ${version + 1}`);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
}

export function getDatabase(): Promise<Database> {
  if (dbPromise) return dbPromise;
  dbPromise = (async () => {
    const SQL = await initSqlJs({ locateFile: () => wasmUrl });
    const saved = await readFile();
    const db = saved ? new SQL.Database(saved) : new SQL.Database();
    db.exec("PRAGMA foreign_keys = ON");
    migrate(db);
    if (!saved) await writeFile(db.export());
    return db;
  })();
  return dbPromise;
}

export function persist(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void flush();
  }, SAVE_DEBOUNCE_MS);
}

export async function flush(): Promise<void> {
  if (!dbPromise) return;
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  const db = await dbPromise;
  await writeFile(db.export());
}

export async function exportBytes(): Promise<Uint8Array> {
  const db = await getDatabase();
  return db.export();
}

// A tab closing mid-debounce would otherwise drop the last edit.
if (typeof window !== "undefined") {
  window.addEventListener("pagehide", () => void flush());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void flush();
  });
}
