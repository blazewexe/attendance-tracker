export type AttendanceStatus = 'unknown' | 'present' | 'absent' | 'cancelled';
export type ActivityType = 'lecture' | 'lab' | 'workshop' | 'college-event' | 'assignment' | 'deadline' | 'note' | 'other';
export type AlertLevel = 'safe' | 'warning' | 'critical';

export interface Entity { id: string; createdAt?: string; updatedAt?: string }
export interface Subject extends Entity { name: string; color: string }
export interface TimetableEntry extends Entity { subjectId: string; weekday: number; start: string; end: string; room: string; active: boolean }
export interface AttendanceRecord extends Entity { date: string; subjectId: string; entryId?: string; start: string; end: string; room?: string; status: AttendanceStatus; title?: string; type?: ActivityType; scheduleChange?: boolean; source?: 'personal' | 'timetable' }
export interface EventRecord extends Entity { date: string; start?: string; end?: string; title: string; type: ActivityType; description?: string }
export interface DailyNote extends Entity { date: string; text: string }
export interface OfficialObservation extends Entity { date: string; subjectId?: string; subjectName: string; status: 'present' | 'absent'; sourceName: string; personalRecordId?: string }
export interface Holiday extends Entity { date: string; name: string }
export interface ImportRecord extends Entity { importedAt: string; fileName: string; count: number }
export interface AppSettings extends Entity {
  minimum: number; buffer: number; notificationsEnabled: boolean; dailySummary: boolean;
  recoveryNotifications: boolean; cooldownHours: number; reminderTime: string;
  semesterStart: string; semesterEnd: string; selectedView: string;
}
export interface NotificationState extends Entity { subjectId: string; level: AlertLevel; percentage: number; lastSentAt: string; episode: number }
export interface Counts { present: number; absent: number; unknown: number; cancelled: number; eligible: number }
export interface AttendanceSummary extends Counts { percentage: number | null }
export interface BackupData {
  schemaVersion: number; exportedAt: string; subjects: Subject[]; timetable: TimetableEntry[];
  attendance: AttendanceRecord[]; official: OfficialObservation[]; events: EventRecord[];
  notes: DailyNote[]; holidays: Holiday[]; settings: AppSettings[]; imports: ImportRecord[]; notifications: NotificationState[];
}

export const DEFAULT_SETTINGS: AppSettings = {
  id: 'settings', minimum: 75, buffer: 5, notificationsEnabled: false, dailySummary: false,
  recoveryNotifications: true, cooldownHours: 24, reminderTime: '18:00', semesterStart: '', semesterEnd: '', selectedView: 'today',
};

export function summarize(records: readonly AttendanceRecord[]): AttendanceSummary {
  const counts: Counts = { present: 0, absent: 0, unknown: 0, cancelled: 0, eligible: 0 };
  for (const record of records) counts[record.status] += 1;
  counts.eligible = counts.present + counts.absent;
  return { ...counts, percentage: counts.eligible ? counts.present / counts.eligible * 100 : null };
}

export function summarizeBySubject(records: readonly AttendanceRecord[], subjects: readonly Subject[]): Array<{ subject: Subject; summary: AttendanceSummary }> {
  return subjects.map((subject) => ({ subject, summary: summarize(records.filter((record) => record.subjectId === subject.id)) }));
}

export function alertLevel(percentage: number | null, minimum: number, buffer: number): AlertLevel {
  if (percentage === null || percentage >= minimum + buffer) return 'safe';
  return percentage >= minimum ? 'warning' : 'critical';
}

export function recoveryClasses(present: number, absent: number, minimum: number): number | null {
  if (!Number.isFinite(minimum) || minimum < 0 || minimum >= 1) return null;
  const eligible = present + absent;
  if (eligible === 0 || present / eligible >= minimum) return 0;
  return Math.max(0, Math.ceil((minimum * eligible - present) / (1 - minimum) - 1e-10));
}

export function discrepancy(personal: AttendanceStatus, official: 'present' | 'absent'): boolean {
  return (personal === 'present' || personal === 'absent') && personal !== official;
}

export function localDate(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function addDays(date: string, amount: number): string {
  const [year, month, day] = date.split('-').map(Number);
  const value = new Date(Date.UTC(year, month - 1, day + amount));
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, '0')}-${String(value.getUTCDate()).padStart(2, '0')}`;
}

export function monthCells(year: number, monthIndex: number): Array<string | null> {
  const firstWeekday = new Date(year, monthIndex, 1).getDay();
  const count = new Date(year, monthIndex + 1, 0).getDate();
  const cells: Array<string | null> = Array.from({ length: firstWeekday }, () => null);
  for (let day = 1; day <= count; day += 1) cells.push(`${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

export function moveMonth(year: number, monthIndex: number, offset: number): [number, number] {
  const date = new Date(year, monthIndex + offset, 1);
  return [date.getFullYear(), date.getMonth()];
}

export interface ScheduleInput { entry: TimetableEntry; startDate: string; endDate: string; holidays: readonly Holiday[]; existing: readonly AttendanceRecord[] }
export function generateSchedule(input: ScheduleInput): AttendanceRecord[] {
  const { entry, startDate, endDate, holidays, existing } = input;
  if (!entry.active || !startDate || !endDate || startDate > endDate) return [];
  const holidayDates = new Set(holidays.map((holiday) => holiday.date));
  const existingIds = new Set(existing.map((record) => record.id));
  const generated: AttendanceRecord[] = [];
  for (let date = startDate; date <= endDate; date = addDays(date, 1)) {
    const [year, month, day] = date.split('-').map(Number);
    const weekday = new Date(year, month - 1, day).getDay();
    const id = `${entry.id}@${date}`;
    if (weekday !== entry.weekday || holidayDates.has(date) || existingIds.has(id)) continue;
    generated.push({ id, date, subjectId: entry.subjectId, entryId: entry.id, start: entry.start, end: entry.end, room: entry.room, status: 'unknown', source: 'timetable', createdAt: new Date().toISOString() });
  }
  return generated;
}

export function updateAttendance(record: AttendanceRecord, status: AttendanceStatus): AttendanceRecord {
  return { ...record, status, updatedAt: new Date().toISOString() };
}
