import { alertLevel, type AlertLevel, type AttendanceRecord, type NotificationState, type Subject, summarizeBySubject } from './domain';

export interface Notice { subjectId: string; level: AlertLevel; percentage: number; title: string; body: string }

export function collectNotices(subjects: readonly Subject[], records: readonly AttendanceRecord[], minimum: number, buffer: number, states: readonly NotificationState[], now = new Date(), cooldownHours = 24): Notice[] {
  const summaries = summarizeBySubject(records, subjects);
  const notices: Notice[] = [];
  for (const { subject, summary } of summaries) {
    if (summary.percentage === null) continue;
    const level = alertLevel(summary.percentage, minimum, buffer);
    const previous = states.find((state) => state.subjectId === subject.id);
    if (level === 'safe' || previous?.level === level && level !== 'critical') continue;
    if (level === 'warning' && previous && previous.level !== 'safe') continue;
    if (level === 'critical' && previous?.level === 'critical') {
      const materiallyLower = previous.percentage - summary.percentage >= 5;
      const cooldownPassed = now.getTime() - Date.parse(previous.lastSentAt) >= cooldownHours * 3_600_000;
      if (!materiallyLower || !cooldownPassed) continue;
    }
    const percent = Math.round(summary.percentage);
    notices.push(level === 'warning'
      ? { subjectId: subject.id, level, percentage: summary.percentage, title: 'Attendance warning', body: `${subject.name} is at ${percent}%. Your configured minimum is ${minimum}%.` }
      : { subjectId: subject.id, level, percentage: summary.percentage, title: 'Attendance below threshold', body: `${subject.name} is at ${percent}%. You may need additional attended classes to recover.` });
  }
  return notices;
}

export async function requestNotificationPermission(): Promise<NotificationPermission | 'unsupported'> {
  if (!('Notification' in window)) return 'unsupported';
  return Notification.requestPermission();
}

export function sendBrowserNotice(notice: Notice): boolean {
  if (!('Notification' in window) || Notification.permission !== 'granted') return false;
  new Notification(notice.title, { body: notice.body, icon: `${import.meta.env.BASE_URL}icons/icon-192.png`, tag: `attendance-${notice.subjectId}-${notice.level}` });
  return true;
}
