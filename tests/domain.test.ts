import { describe, expect, it } from 'vitest';
import { alertLevel, addDays, generateSchedule, localDate, monthCells, moveMonth, recoveryClasses, summarize, summarizeBySubject, type AttendanceRecord, type Subject, type TimetableEntry } from '../src/domain';

const records: AttendanceRecord[] = [
  { id: '1', date: '2026-01-01', subjectId: 'math', start: '09:00', end: '10:00', status: 'present' },
  { id: '2', date: '2026-01-02', subjectId: 'math', start: '09:00', end: '10:00', status: 'absent' },
  { id: '3', date: '2026-01-03', subjectId: 'math', start: '09:00', end: '10:00', status: 'unknown' },
  { id: '4', date: '2026-01-04', subjectId: 'math', start: '09:00', end: '10:00', status: 'cancelled' },
];

describe('attendance calculations', () => {
  it('counts only present and absent sessions', () => expect(summarize(records)).toMatchObject({ present: 1, absent: 1, unknown: 1, cancelled: 1, eligible: 2, percentage: 50 }));
  it('returns no percentage when there are no eligible records', () => expect(summarize(records.slice(2)).percentage).toBeNull());
  it('calculates attendance independently by subject', () => {
    const subjects: Subject[] = [{ id: 'math', name: 'Math', color: '#f00' }, { id: 'physics', name: 'Physics', color: '#0f0' }];
    expect(summarizeBySubject(records, subjects).map((item) => item.summary.percentage)).toEqual([50, null]);
  });
  it('handles safe, warning and critical boundaries exactly', () => {
    expect(alertLevel(80, 75, 5)).toBe('safe');
    expect(alertLevel(79.99, 75, 5)).toBe('warning');
    expect(alertLevel(75, 75, 5)).toBe('warning');
    expect(alertLevel(74.99, 75, 5)).toBe('critical');
    expect(alertLevel(null, 75, 5)).toBe('safe');
    expect(alertLevel(85, 80, 5)).toBe('safe');
    expect(alertLevel(82, 80, 5)).toBe('warning');
    expect(alertLevel(79, 80, 5)).toBe('critical');
  });
  it('projects consecutive classes needed for recovery', () => {
    expect(recoveryClasses(3, 1, .75)).toBe(0);
    expect(recoveryClasses(2, 2, .75)).toBe(4);
    expect(recoveryClasses(0, 1, .75)).toBe(3);
    expect(recoveryClasses(0, 0, .75)).toBe(0);
    expect(recoveryClasses(1, 0, 1)).toBeNull();
  });
});

describe('calendar and local dates', () => {
  it('generates leap February with correct weekday alignment', () => {
    const days = monthCells(2024, 1).filter(Boolean);
    expect(days).toHaveLength(29);
    expect(monthCells(2024, 1)[4]).toBe('2024-02-01'); // Thursday, Sunday-first grid
  });
  it('handles month and year transitions', () => {
    expect(moveMonth(2026, 0, -1)).toEqual([2025, 11]);
    expect(moveMonth(2026, 11, 1)).toEqual([2027, 0]);
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });
  it('formats dates in local calendar fields and keeps date arithmetic timezone-neutral', () => {
    expect(localDate(new Date(2026, 9, 24, 23, 59))).toBe('2026-10-24');
    expect(addDays('2026-03-08', 1)).toBe('2026-03-09');
  });
});

describe('timetable generation', () => {
  const entry: TimetableEntry = { id: 'class-a', subjectId: 'math', weekday: 1, start: '09:00', end: '10:00', room: 'B1', active: true };
  it('creates only matching weekdays within semester boundaries', () => {
    const result = generateSchedule({ entry, startDate: '2026-06-01', endDate: '2026-06-14', holidays: [], existing: [] });
    expect(result.map((item) => item.date)).toEqual(['2026-06-01', '2026-06-08']);
  });
  it('skips holidays and keeps existing attendance decisions on regeneration', () => {
    const existing = [{ ...records[0]!, id: 'class-a@2026-06-01', date: '2026-06-01', status: 'absent' as const }];
    const result = generateSchedule({ entry, startDate: '2026-06-01', endDate: '2026-06-08', holidays: [{ id: 'h', date: '2026-06-08', name: 'Holiday' }], existing });
    expect(result).toHaveLength(0);
    expect(existing[0]?.status).toBe('absent');
  });
  it('is idempotent and does not generate duplicates', () => {
    const first = generateSchedule({ entry, startDate: '2026-06-01', endDate: '2026-06-08', holidays: [], existing: [] });
    const second = generateSchedule({ entry, startDate: '2026-06-01', endDate: '2026-06-08', holidays: [], existing: first });
    expect(first).toHaveLength(2);
    expect(second).toHaveLength(0);
  });
});
