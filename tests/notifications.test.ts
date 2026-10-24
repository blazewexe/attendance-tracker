import { describe, expect, it, vi } from 'vitest';
import { collectNotices, requestNotificationPermission, sendBrowserNotice } from '../src/notifications';
import type { AttendanceRecord, Subject } from '../src/domain';

const subject: Subject = { id: 'm', name: 'Mathematics', color: '#e00' };
const record = (id: string, status: AttendanceRecord['status']): AttendanceRecord => ({ id, date: '2026-01-01', subjectId: 'm', start: '09:00', end: '10:00', status });
const at = new Date('2026-01-01T12:00:00Z');

describe('notification state transitions', () => {
  it('emits first warning and critical transitions once', () => {
    expect(collectNotices([subject], [record('1','present'), record('2','absent')], 75, 5, [], at)[0]?.level).toBe('critical');
    const warning = [record('1','present'), record('2','present'), record('3','present'), record('4','absent')];
    expect(collectNotices([subject], warning, 75, 5, [], at)[0]?.level).toBe('warning');
    const saved = [{ id: 'm', subjectId: 'm', level: 'warning' as const, percentage: 75, lastSentAt: at.toISOString(), episode: 1 }];
    expect(collectNotices([subject], warning, 75, 5, saved, at)).toHaveLength(0);
  });
  it('throttles critical deterioration and permits it after cooldown when materially lower', () => {
    const start = Array.from({ length: 4 }, (_, i) => record(String(i), i === 3 ? 'absent' : 'present'));
    const lower = [...start, ...Array.from({ length: 6 }, (_, i) => record(`x${i}`, 'absent'))];
    const states = [{ id: 'm', subjectId: 'm', level: 'critical' as const, percentage: 75, lastSentAt: at.toISOString(), episode: 1 }];
    expect(collectNotices([subject], lower, 75, 5, states, at, 24)).toHaveLength(0);
    const later = new Date(at.getTime() + 25 * 3_600_000);
    expect(collectNotices([subject], lower, 75, 5, states, later, 24)).toHaveLength(1);
  });
  it('allows a new critical alert after recovery and re-entry', () => {
    const critical = [record('1','present'), record('2','absent')];
    const recovered = [{ id: 'm', subjectId: 'm', level: 'safe' as const, percentage: 100, lastSentAt: at.toISOString(), episode: 1 }];
    expect(collectNotices([subject], critical, 75, 5, recovered, at)[0]?.level).toBe('critical');
  });
  it('does not reissue a warning when a critical subject improves into warning range', () => {
    const warning = [record('1','present'), record('2','present'), record('3','present'), record('4','absent')];
    const criticalState = [{ id: 'm', subjectId: 'm', level: 'critical' as const, percentage: 70, lastSentAt: at.toISOString(), episode: 1 }];
    expect(collectNotices([subject], warning, 75, 5, criticalState, at)).toHaveLength(0);
  });
  it('degrades cleanly when the Notifications API is missing', async () => {
    vi.stubGlobal('window', {});
    expect(await requestNotificationPermission()).toBe('unsupported');
    expect(sendBrowserNotice({ subjectId: 'm', level: 'warning', percentage: 78, title: 'Warning', body: 'Attendance warning' })).toBe(false);
    vi.unstubAllGlobals();
  });
});
