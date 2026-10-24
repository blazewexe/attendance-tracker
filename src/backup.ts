import { DEFAULT_SETTINGS, type BackupData } from './domain';

export const BACKUP_VERSION = 1;
const ARRAY_KEYS = ['subjects', 'timetable', 'attendance', 'official', 'events', 'notes', 'holidays', 'settings', 'imports', 'notifications'] as const;

function validDate(value: unknown): boolean {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year!, month! - 1, day!));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month! - 1 && parsed.getUTCDate() === day;
}

export function createBackup(data: Omit<BackupData, 'schemaVersion' | 'exportedAt'>): BackupData {
  return { schemaVersion: BACKUP_VERSION, exportedAt: new Date().toISOString(), ...data };
}

export function parseBackup(text: string): BackupData {
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { throw new Error('This file is not valid JSON.'); }
  if (!parsed || typeof parsed !== 'object') throw new Error('Backup must be a JSON object.');
  const candidate = parsed as Partial<BackupData>;
  if (candidate.schemaVersion !== BACKUP_VERSION) throw new Error(`Unsupported backup version: ${String(candidate.schemaVersion)}.`);
  if (typeof candidate.exportedAt !== 'string' || Number.isNaN(Date.parse(candidate.exportedAt))) throw new Error('Backup needs a valid export timestamp.');
  for (const key of ARRAY_KEYS) if (!Array.isArray(candidate[key])) throw new Error(`Backup is missing the ${key} list.`);
  for (const key of ARRAY_KEYS) {
    for (const [index, item] of (candidate[key] as unknown[]).entries()) {
      if (!item || typeof item !== 'object' || !('id' in item) || typeof item.id !== 'string' || !/^[A-Za-z0-9_.@-]{1,180}$/.test(item.id)) throw new Error(`Invalid ${key} entry at row ${index + 1}: every record needs a safe ID.`);
    }
  }
  const requiredFields: Record<string, string[]> = { subjects: ['id', 'name'], timetable: ['id', 'subjectId', 'weekday', 'start', 'end'], attendance: ['id', 'date', 'subjectId', 'status'], official: ['id', 'date', 'subjectName', 'status'], events: ['id', 'date', 'title', 'type'], notes: ['id', 'date', 'text'], holidays: ['id', 'date', 'name'] };
  for (const [key, fields] of Object.entries(requiredFields)) {
    for (const [index, item] of (candidate[key as keyof BackupData] as unknown[]).entries()) {
      if (!item || typeof item !== 'object' || fields.some((field) => !(field in item))) throw new Error(`Invalid ${key} entry at row ${index + 1}.`);
    }
  }
  for (const key of ['attendance', 'events', 'notes', 'official', 'holidays'] as const) {
    for (const [index, item] of candidate[key]!.entries()) {
      if (!validDate(item.date)) throw new Error(`Invalid ${key} date at row ${index + 1}.`);
    }
  }
  const validAttendance = new Set(['unknown', 'present', 'absent', 'cancelled']);
  for (const [index, item] of candidate.attendance!.entries()) if (!validAttendance.has(item.status)) throw new Error(`Invalid attendance status at row ${index + 1}.`);
  for (const [index, item] of candidate.official!.entries()) if (item.status !== 'present' && item.status !== 'absent') throw new Error(`Invalid official status at row ${index + 1}.`);
  for (const [index, item] of candidate.timetable!.entries()) if (typeof item.weekday !== 'number' || item.weekday < 0 || item.weekday > 6) throw new Error(`Invalid timetable weekday at row ${index + 1}.`);
  for (const [index, item] of candidate.subjects!.entries()) if (typeof item.name !== 'string' || !item.name.trim()) throw new Error(`Invalid subject name at row ${index + 1}.`);
  for (const [index, item] of candidate.events!.entries()) if (typeof item.title !== 'string' || !item.title.trim() || !['lecture','lab','workshop','college-event','assignment','deadline','note','other'].includes(item.type)) throw new Error(`Invalid activity at row ${index + 1}.`);
  for (const [index, item] of candidate.notes!.entries()) if (typeof item.text !== 'string') throw new Error(`Invalid daily note at row ${index + 1}.`);
  for (const [index, item] of candidate.holidays!.entries()) if (typeof item.name !== 'string' || !item.name.trim()) throw new Error(`Invalid holiday at row ${index + 1}.`);
  for (const [index, item] of candidate.settings!.entries()) {
    if (typeof item.minimum !== 'number' || item.minimum < 1 || item.minimum > 100 || typeof item.buffer !== 'number' || item.buffer < 0 || item.buffer > 50 || typeof item.notificationsEnabled !== 'boolean' || typeof item.dailySummary !== 'boolean' || typeof item.recoveryNotifications !== 'boolean' || typeof item.cooldownHours !== 'number' || item.cooldownHours < 1 || typeof item.reminderTime !== 'string' || !/^\d{2}:\d{2}$/.test(item.reminderTime) || item.semesterStart && !validDate(item.semesterStart) || item.semesterEnd && !validDate(item.semesterEnd)) throw new Error(`Invalid settings at row ${index + 1}.`);
  }
  for (const [index, item] of candidate.imports!.entries()) if (typeof item.fileName !== 'string' || typeof item.count !== 'number' || item.count < 0 || Number.isNaN(Date.parse(item.importedAt))) throw new Error(`Invalid import history at row ${index + 1}.`);
  for (const [index, item] of candidate.notifications!.entries()) if (!['safe','warning','critical'].includes(item.level) || typeof item.subjectId !== 'string' || typeof item.percentage !== 'number' || Number.isNaN(Date.parse(item.lastSentAt))) throw new Error(`Invalid notification state at row ${index + 1}.`);
  return { ...(candidate as BackupData), settings: candidate.settings?.length ? candidate.settings : [DEFAULT_SETTINGS] };
}

export function mergeBackup(current: BackupData, incoming: BackupData, mode: 'merge' | 'replace'): BackupData {
  if (mode === 'replace') return incoming;
  const result = { ...current };
  for (const key of ARRAY_KEYS) {
    const items = new Map<string, unknown>();
    for (const item of current[key] as Array<{ id: string }>) items.set(item.id, item);
    for (const item of incoming[key] as Array<{ id: string }>) items.set(item.id, item);
    (result[key] as unknown[]) = [...items.values()];
  }
  return result;
}
