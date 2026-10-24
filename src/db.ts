import { DEFAULT_SETTINGS, type AppSettings, type AttendanceRecord, type BackupData, type DailyNote, type Entity, type EventRecord, type Holiday, type ImportRecord, type NotificationState, type OfficialObservation, type Subject, type TimetableEntry } from './domain';

export const STORE_NAMES = ['subjects', 'timetable', 'attendance', 'official', 'events', 'notes', 'holidays', 'settings', 'imports', 'notifications'] as const;
export type StoreName = typeof STORE_NAMES[number];
export interface StoreTypes {
  subjects: Subject; timetable: TimetableEntry; attendance: AttendanceRecord; official: OfficialObservation;
  events: EventRecord; notes: DailyNote; holidays: Holiday; settings: AppSettings; imports: ImportRecord; notifications: NotificationState;
}

const DB_NAME = 'attendance-tracker';
const DB_VERSION = 1;
let connection: Promise<IDBDatabase> | undefined;

function openDb(): Promise<IDBDatabase> {
  if (connection) return connection;
  connection = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      const stores: StoreName[] = [...STORE_NAMES];
      for (const name of stores) {
        if (db.objectStoreNames.contains(name)) continue;
        const store = db.createObjectStore(name, { keyPath: 'id' });
        if (name === 'attendance' || name === 'events' || name === 'notes' || name === 'official' || name === 'holidays') store.createIndex('date', 'date');
        if (name === 'attendance' || name === 'official') store.createIndex('subjectId', 'subjectId');
        if (name === 'attendance') store.createIndex('status', 'status');
      }
    };
    request.onsuccess = () => { request.result.onversionchange = () => request.result.close(); resolve(request.result); };
    request.onerror = () => { connection = undefined; reject(request.error ?? new Error('Could not open local storage.')); };
    request.onblocked = () => reject(new Error('Database upgrade is blocked by another open Attendance Tracker tab. Close other tabs and reload.'));
  });
  return connection;
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error('Storage transaction was cancelled.'));
    transaction.onerror = () => reject(transaction.error ?? new Error('Storage transaction failed.'));
  });
}

export async function getAll<K extends StoreName>(name: K): Promise<StoreTypes[K][]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction(name, 'readonly').objectStore(name).getAll();
    request.onsuccess = () => resolve(request.result as StoreTypes[K][]);
    request.onerror = () => reject(request.error ?? new Error(`Could not read ${name}.`));
  });
}

export async function getByDate<K extends 'attendance' | 'events' | 'notes' | 'official' | 'holidays'>(name: K, date: string): Promise<StoreTypes[K][]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction(name, 'readonly').objectStore(name).index('date').getAll(date);
    request.onsuccess = () => resolve(request.result as StoreTypes[K][]);
    request.onerror = () => reject(request.error ?? new Error(`Could not read ${name} for ${date}.`));
  });
}

export async function put<K extends StoreName>(name: K, value: StoreTypes[K]): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(name, 'readwrite');
  tx.objectStore(name).put(value);
  await transactionDone(tx);
}

export async function putMany<K extends StoreName>(name: K, values: StoreTypes[K][]): Promise<void> {
  if (!values.length) return;
  const db = await openDb();
  const tx = db.transaction(name, 'readwrite');
  const store = tx.objectStore(name);
  for (const value of values) store.put(value);
  await transactionDone(tx);
}

export async function remove<K extends StoreName>(name: K, id: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(name, 'readwrite');
  tx.objectStore(name).delete(id);
  await transactionDone(tx);
}

export async function getSettings(): Promise<AppSettings> {
  return (await getAll('settings'))[0] ?? DEFAULT_SETTINGS;
}

export async function loadBackupData(): Promise<BackupData> {
  const [subjects, timetable, attendance, official, events, notes, holidays, settings, imports, notifications] = await Promise.all(STORE_NAMES.map((store) => getAll(store)));
  return { schemaVersion: 1, exportedAt: new Date().toISOString(), subjects, timetable, attendance, official, events, notes, holidays, settings, imports, notifications } as BackupData;
}

export async function restoreBackup(data: BackupData, mode: 'merge' | 'replace'): Promise<void> {
  const db = await openDb();
  const tx = db.transaction([...STORE_NAMES], 'readwrite');
  if (mode === 'replace') for (const name of STORE_NAMES) tx.objectStore(name).clear();
  const values: Record<StoreName, Entity[]> = {
    subjects: data.subjects, timetable: data.timetable, attendance: data.attendance, official: data.official,
    events: data.events, notes: data.notes, holidays: data.holidays, settings: data.settings.length ? data.settings : [DEFAULT_SETTINGS],
    imports: data.imports, notifications: data.notifications,
  };
  for (const name of STORE_NAMES) for (const item of values[name]) tx.objectStore(name).put(item);
  await transactionDone(tx);
}

export async function requestStoragePersistence(): Promise<boolean> {
  if (!navigator.storage?.persist) return false;
  return navigator.storage.persist();
}
