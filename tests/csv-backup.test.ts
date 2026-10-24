import { describe, expect, it } from 'vitest';
import { parseCsv, mapOfficialCsv } from '../src/csv';
import { createBackup, mergeBackup, parseBackup } from '../src/backup';
import type { BackupData, Subject } from '../src/domain';

describe('official CSV import', () => {
  it('parses commas, quotes and line breaks in quoted fields', () => {
    expect(parseCsv('Date,Subject,Status\r\n2026-01-01,"Math, Applied",Present\r\n2026-01-02,"Physics ""II""",Absent')).toEqual([
      ['Date', 'Subject', 'Status'], ['2026-01-01', 'Math, Applied', 'Present'], ['2026-01-02', 'Physics "II"', 'Absent'],
    ]);
  });
  it('rejects malformed quoted CSV and missing data rows', () => {
    expect(() => parseCsv('Date,Subject\n2026-01-01,"Math')).toThrow(/unclosed/);
    expect(() => parseCsv('Date,Subject')).toThrow(/at least one/);
  });
  it('maps subjects, validates statuses and detects conflicts and duplicates', () => {
    const subjects: Subject[] = [{ id: 'm', name: 'Math', color: '#f00' }];
    const rows = [['Date', 'Subject', 'Status'], ['2026-01-01', 'Math', 'Absent'], ['2026-01-01', 'Math', 'Present'], ['2026-01-03', 'Mystery', 'Present'], ['bad', 'Math', 'Maybe']];
    const result = mapOfficialCsv(rows, { date: 0, subject: 1, status: 2 }, subjects, [{ id: 'a', date: '2026-01-01', subjectId: 'm', start: '', end: '', status: 'present' }]);
    expect(result[0]?.personal?.status).toBe('present');
    expect(result[0]?.status).toBe('absent');
    expect(result[1]?.duplicate).toBe(true);
    expect(result[2]?.issue).toMatch(/not configured/);
    expect(result[3]?.issue).toMatch(/Invalid date/);
    expect(mapOfficialCsv([['Date','Subject','Status'],['2026-02-31','Math','Present']], { date: 0, subject: 1, status: 2 }, subjects, [])[0]?.issue).toMatch(/real date/);
  });
});

describe('backup validation and restore merge', () => {
  const empty = () => createBackup({ subjects: [], timetable: [], attendance: [], official: [], events: [], notes: [], holidays: [], settings: [], imports: [], notifications: [] });
  it('validates JSON shape and schema version', () => {
    expect(() => parseBackup('{')).toThrow(/valid JSON/);
    expect(() => parseBackup(JSON.stringify({ ...empty(), schemaVersion: 99 }))).toThrow(/Unsupported/);
    expect(() => parseBackup(JSON.stringify({ schemaVersion: 1, exportedAt: new Date().toISOString() }))).toThrow(/subjects list/);
    const unsafeId = empty();
    unsafeId.attendance.push({ id: 'bad id', date: '2026-02-28', subjectId: 'math', start: '09:00', end: '10:00', status: 'present' });
    expect(() => parseBackup(JSON.stringify(unsafeId))).toThrow(/safe ID/);
    const malformed = empty();
    malformed.attendance.push({ id: 'safe-id', date: '2026-02-31', subjectId: 'math', start: '09:00', end: '10:00', status: 'present' });
    expect(() => parseBackup(JSON.stringify(malformed))).toThrow(/attendance date/);
  });
  it('merges by stable ID and replaces when requested', () => {
    const current = empty();
    current.subjects.push({ id: 'a', name: 'Old', color: '#000' });
    const incoming: BackupData = empty();
    incoming.subjects.push({ id: 'a', name: 'New', color: '#fff' }, { id: 'b', name: 'Physics', color: '#f00' });
    expect(mergeBackup(current, incoming, 'merge').subjects.map((item) => item.name)).toEqual(['New', 'Physics']);
    expect(mergeBackup(current, incoming, 'replace').subjects).toHaveLength(2);
  });
});
