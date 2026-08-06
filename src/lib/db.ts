const DB_NAME = "project-planner";
const DB_VERSION = 1;
const ASSIGNMENTS_STORE = "projectAssignments";

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(ASSIGNMENTS_STORE)) {
        db.createObjectStore(ASSIGNMENTS_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

export async function loadAllAssignments(): Promise<Record<string, number>> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(ASSIGNMENTS_STORE, "readonly");
    const store = tx.objectStore(ASSIGNMENTS_STORE);
    const result: Record<string, number> = {};
    const cursorRequest = store.openCursor();
    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result;
      if (cursor) {
        result[String(cursor.key)] = cursor.value as number;
        cursor.continue();
      } else {
        resolve(result);
      }
    };
    cursorRequest.onerror = () => reject(cursorRequest.error);
  });
}

export async function saveAssignment(projectId: string, people: number): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(ASSIGNMENTS_STORE, "readwrite");
    tx.objectStore(ASSIGNMENTS_STORE).put(people, projectId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function clearAssignment(projectId: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(ASSIGNMENTS_STORE, "readwrite");
    tx.objectStore(ASSIGNMENTS_STORE).delete(projectId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
