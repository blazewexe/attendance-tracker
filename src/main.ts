import './style.css';
import { addDays, alertLevel, DEFAULT_SETTINGS, generateSchedule, localDate, monthCells, moveMonth, recoveryClasses, summarize, summarizeBySubject, updateAttendance, type ActivityType, type AppSettings, type AttendanceRecord, type DailyNote, type EventRecord, type NotificationState, type Subject, type TimetableEntry } from './domain';
import { getAll, getSettings, loadBackupData, put, putMany, remove, requestStoragePersistence, restoreBackup } from './db';
import { createBackup, mergeBackup, parseBackup } from './backup';
import { csvEscape, mapOfficialCsv, parseCsv, toOfficialObservation, type CsvMapping, type CsvPreviewRow } from './csv';
import { collectNotices, requestNotificationPermission, sendBrowserNotice } from './notifications';

type View = 'today' | 'calendar' | 'history' | 'records' | 'settings' | 'timetable';
interface AppData {
  subjects: Subject[]; timetable: TimetableEntry[]; attendance: AttendanceRecord[];
  official: Awaited<ReturnType<typeof getAll<'official'>>>; events: EventRecord[]; notes: DailyNote[];
  holidays: Awaited<ReturnType<typeof getAll<'holidays'>>>; imports: Awaited<ReturnType<typeof getAll<'imports'>>>;
  notifications: NotificationState[]; settings: AppSettings;
}

const root = document.querySelector<HTMLDivElement>('#app')!;
let today = localDate();
let data: AppData;
let view: View = 'today';
let selectedDate = today;
let month = new Date().getMonth();
let year = new Date().getFullYear();
let searchTerm = '';
let historyFilter = 'all';
let historyFrom = '';
let historyTo = '';
let historySubject = '';
let toastTimer = 0;

const esc = (value: unknown): string => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const id = (): string => crypto.randomUUID();
const nowIso = (): string => new Date().toISOString();
const subjectName = (key: string): string => data.subjects.find((subject) => subject.id === key)?.name ?? 'Unmatched subject';
const formatDate = (date: string, options: Intl.DateTimeFormatOptions = { weekday: 'long', month: 'long', day: 'numeric' }): string => {
  const [y, m, d] = date.split('-').map(Number);
  return new Intl.DateTimeFormat(undefined, options).format(new Date(y!, m! - 1, d!));
};
const timeOrder = (a: { start?: string }, b: { start?: string }): number => (a.start ?? '99:99').localeCompare(b.start ?? '99:99');
const statusLabel: Record<AttendanceRecord['status'], string> = { unknown: 'UNVERIFIED', present: 'PRESENT', absent: 'ABSENT', cancelled: 'CANCELLED' };
const eventLabel: Record<ActivityType, string> = { lecture: 'LECTURE', lab: 'LAB', workshop: 'WORKSHOP', 'college-event': 'COLLEGE EVENT', assignment: 'ASSIGNMENT', deadline: 'DEADLINE', note: 'NOTE', other: 'ACTIVITY' };

function icon(name: string): string {
  const paths: Record<string, string> = {
    today: '<rect x="3" y="5" width="18" height="16" rx="1"/><path d="M16 3v4M8 3v4M3 10h18M8 14h2m4 0h2m-8 4h2"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="1"/><path d="M16 3v4M8 3v4M3 10h18M8 14h.01M12 14h.01M16 14h.01"/>',
    history: '<path d="M3 12a9 9 0 1 0 2.6-6.4L3 8"/><path d="M3 3v5h5m4-1v5l4 2"/>',
    records: '<path d="M5 3h14v18H5zM8 7h8M8 11h2m3 0h3m-8 4h2m3 0h3"/>',
    plus: '<path d="M12 5v14M5 12h14"/>', menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    back: '<path d="m15 18-6-6 6-6"/>', forward: '<path d="m9 18 6-6-6-6"/>', close: '<path d="m6 6 12 12M18 6 6 18"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19 13.5a7 7 0 0 0 0-3l2-1.5-2-3.5-2.4.8a8 8 0 0 0-2.6-1.5L13.5 2h-3L10 4.8a8 8 0 0 0-2.6 1.5L5 5.5 3 9l2 1.5a7 7 0 0 0 0 3L3 15l2 3.5 2.4-.8a8 8 0 0 0 2.6 1.5l.5 2.8h3l.5-2.8a8 8 0 0 0 2.6-1.5l2.4.8 2-3.5z"/>',
    search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>', download: '<path d="M12 3v12m-5-5 5 5 5-5M4 20h16"/>',
    upload: '<path d="M12 16V4m-5 5 5-5 5 5M4 20h16"/>', trash: '<path d="M4 7h16M10 11v6m4-6v6M6 7l1 14h10l1-14M9 7V4h6v3"/>',
    edit: '<path d="m4 16-.8 4.8L8 20l11.7-11.7a2.8 2.8 0 0 0-4-4L4 16Z"/><path d="m14 6 4 4"/>',
  };
  return `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${paths[name] ?? ''}</svg>`;
}

function flash(message: string): void {
  let node = document.querySelector<HTMLDivElement>('.toast');
  if (!node) { node = document.createElement('div'); node.className = 'toast'; node.setAttribute('role', 'status'); root.append(node); }
  node.textContent = message;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => node?.remove(), 3200);
}

async function refresh(): Promise<void> {
  const [subjects, timetable, attendance, official, events, notes, holidays, imports, notifications, settings] = await Promise.all([
    getAll('subjects'), getAll('timetable'), getAll('attendance'), getAll('official'), getAll('events'), getAll('notes'), getAll('holidays'), getAll('imports'), getAll('notifications'), getSettings(),
  ]);
  data = { subjects, timetable, attendance, official, events, notes, holidays, imports, notifications, settings };
}

function header(title: string, eyebrow = 'ATTENDANCE TRACKER / PERSONAL COLLEGE LOG'): string {
  return `<header class="topbar"><button class="brand" type="button" data-view="today" aria-label="Attendance Tracker home"><img src="${import.meta.env.BASE_URL}icons/icon-192.png" alt=""/><span>ATTENDANCE TRACKER</span></button><div class="top-actions"><button class="round-button" data-action="menu" aria-label="Open menu">${icon('menu')}</button><button class="round-button add-button" data-action="add" aria-label="Add record">${icon('plus')}</button></div></header><div class="page-heading"><p class="eyebrow">${esc(eyebrow)}</p><h1>${esc(title)}</h1></div>`;
}

function nav(): string {
  const items: Array<[View, string, string]> = [['today', 'TODAY', 'today'], ['calendar', 'CALENDAR', 'calendar'], ['history', 'HISTORY', 'history'], ['records', 'RECORDS', 'records']];
  return `<nav class="bottom-nav" aria-label="Primary navigation">${items.map(([key, label, iconName]) => `<button class="nav-item ${view === key ? 'active' : ''}" data-view="${key}" ${view === key ? 'aria-current="page"' : ''}>${icon(iconName)}<span>${label}</span></button>`).join('')}</nav>`;
}

function timeline(date: string): string {
  const classes = data.attendance.filter((record) => record.date === date).sort(timeOrder);
  const events = data.events.filter((item) => item.date === date).sort(timeOrder);
  const notes = data.notes.filter((item) => item.date === date);
  const official = data.official.filter((item) => item.date === date);
  const holiday = data.holidays.find((item) => item.date === date);
  if (!classes.length && !events.length && !notes.length && !holiday) return `<div class="empty-inline"><span class="empty-mark">—</span><span>No entries recorded for this date.</span></div>`;
  const classRows = classes.map((record) => {
    const observed = official.find((item) => item.subjectId === record.subjectId || item.subjectName.toLowerCase() === subjectName(record.subjectId).toLowerCase());
    const conflict = observed && (record.status === 'present' || record.status === 'absent') && observed.status !== record.status;
    return `<article class="timeline-row"><time>${esc(record.start || '—')}<span>${esc(record.end || '')}</span></time><div class="timeline-content"><div class="timeline-title"><h3>${esc(record.title || subjectName(record.subjectId))}</h3>${record.room ? `<span class="muted">${esc(record.room)}</span>` : ''}${record.scheduleChange ? '<span class="tag">ONE-OFF CHANGE</span>' : ''}</div><div class="status-line"><span class="status-pill ${record.status}">${statusLabel[record.status]}</span>${conflict ? '<span class="conflict-label">DIFFERS FROM OFFICIAL</span>' : ''}</div><div class="status-actions">${(['present', 'absent', 'unknown', 'cancelled'] as const).map((status) => `<button class="status-choice ${record.status === status ? 'selected' : ''}" data-action="status" data-id="${record.id}" data-status="${status}">${status === 'unknown' ? 'Unverified' : status[0]!.toUpperCase() + status.slice(1)}</button>`).join('')}</div></div></article>`;
  }).join('');
  const eventRows = events.map((item) => `<article class="timeline-row"><time>${esc(item.start || eventLabel[item.type])}${item.end ? `<span>${esc(item.end)}</span>` : ''}</time><div class="timeline-content"><h3>${esc(item.title)}</h3>${item.description ? `<p>${esc(item.description)}</p>` : ''}<span class="tag">${eventLabel[item.type]}</span><button class="text-button" data-action="edit-event" data-id="${item.id}">Edit</button></div></article>`).join('');
  const noteRows = notes.map((item) => `<article class="timeline-row"><time>NOTE</time><div class="timeline-content"><p class="note-text">${esc(item.text)}</p><button class="text-button" data-action="edit-note" data-id="${item.id}">Edit note</button></div></article>`).join('');
  return `<div class="timeline">${holiday ? `<article class="timeline-row"><time>DAY OFF</time><div class="timeline-content"><h3>${esc(holiday.name)}</h3><span class="tag">HOLIDAY</span></div></article>` : ''}${classRows}${eventRows}${noteRows}</div>`;
}

function todayView(): string {
  const summary = summarize(data.attendance.filter((item) => item.date === today));
  const attention = summarizeBySubject(data.attendance, data.subjects).filter(({ summary: item }) => item.percentage !== null && alertLevel(item.percentage, data.settings.minimum, data.settings.buffer) !== 'safe');
  const utcDay = (date: string): number => { const [y, m, d] = date.split('-').map(Number); return Date.UTC(y!, m! - 1, d!) / 86400000; };
  const week = data.settings.semesterStart ? Math.floor((utcDay(today) - utcDay(data.settings.semesterStart)) / 7) + 1 : null;
  const configured = data.timetable.some((entry) => entry.active);
  const hasTodayActivity = data.attendance.some((item) => item.date === today) || data.events.some((item) => item.date === today) || data.notes.some((item) => item.date === today) || data.holidays.some((item) => item.date === today);
  const dateTitle = `${formatDate(today, { weekday: 'long' }).toUpperCase()} / ${formatDate(today, { month: 'long', day: 'numeric', year: 'numeric' }).toUpperCase()}`;
  const empty = `<div class="empty-state"><span class="empty-mark">01</span><h3>No timetable yet.</h3><p>Add your subjects and weekly schedule once. Attendance Tracker will prepare upcoming class records for you.</p><button class="button-primary" data-view="timetable">SET UP TIMETABLE <span>↗</span></button><button class="button-quiet" data-action="add" data-kind="class">ADD A ONE-OFF CLASS</button></div>`;
  const noticeText = attention.length ? `${attention.length} subject${attention.length === 1 ? '' : 's'} need${attention.length === 1 ? 's' : ''} attendance attention` : summary.unknown ? `${summary.unknown} class${summary.unknown === 1 ? '' : 'es'} still unverified today` : 'Personal records save on this device.';
  return `${header('TODAY', dateTitle)}<main class="content"><div class="today-meta"><div><span class="eyebrow">${week && week > 0 ? `SEMESTER WEEK ${week}` : 'YOUR DAILY LOG'}</span><p>A clear record of what happened.</p></div><div class="today-count"><strong>${summary.present}<i> / </i>${summary.present + summary.absent}</strong><span>CLASSES ATTENDED</span></div></div><section class="section-block"><div class="section-title"><h2>THE DAY</h2><button class="text-button" data-action="add" data-date="${today}">＋ ADD ENTRY</button></div>${configured || hasTodayActivity ? timeline(today) : empty}</section><section class="attention-strip ${attention.length ? 'needs-attention' : ''}"><span class="attention-dot"></span><span>${esc(noticeText)}</span><button data-view="records">VIEW RECORDS ↗</button></section></main>`;
}

function indicators(date: string): { attendance: boolean; absent: boolean; event: boolean; unknown: boolean; deadline: boolean } {
  const classes = data.attendance.filter((item) => item.date === date);
  const events = data.events.filter((item) => item.date === date);
  return { attendance: classes.some((item) => item.status === 'present'), absent: classes.some((item) => item.status === 'absent'), event: events.some((item) => item.type === 'college-event' || item.type === 'workshop'), unknown: classes.some((item) => item.status === 'unknown'), deadline: events.some((item) => item.type === 'assignment' || item.type === 'deadline') };
}

function calendarView(): string {
  const cells = monthCells(year, month);
  const monthTitle = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(new Date(year, month, 1));
  const dayCells = cells.map((date) => {
    if (!date) return '<span class="day-cell blank" aria-hidden="true"></span>';
    const marks = indicators(date);
    const parts = [marks.attendance ? 'attended class' : '', marks.absent ? 'absent class' : '', marks.event ? 'event' : '', marks.unknown ? 'unverified class' : '', marks.deadline ? 'assignment or deadline' : ''].filter(Boolean);
    const aria = `${formatDate(date, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}${parts.length ? `, ${parts.join(', ')}` : ''}`;
    const dots = `${marks.attendance ? '<b class="mark present" aria-hidden="true"></b>' : ''}${marks.absent ? '<b class="mark absent" aria-hidden="true">!</b>' : ''}${marks.event ? '<b class="mark event" aria-hidden="true">E</b>' : ''}${marks.unknown ? '<b class="mark unknown" aria-hidden="true">?</b>' : ''}${marks.deadline ? '<b class="mark deadline" aria-hidden="true">D</b>' : ''}`;
    return `<button role="gridcell" class="day-cell ${selectedDate === date ? 'selected' : ''} ${today === date ? 'is-today' : ''}" data-action="select-date" data-date="${date}" aria-label="${esc(aria)}" aria-selected="${selectedDate === date}"><span>${Number(date.slice(-2))}</span><i class="marks">${dots}</i></button>`;
  }).join('');
  const weekdays = ['SUN','MON','TUE','WED','THU','FRI','SAT'].map((day) => `<span role="columnheader">${day}</span>`).join('');
  return `${header('CALENDAR', 'YOUR MONTH, IN CONTEXT')}<main class="content"><div class="calendar-toolbar"><button class="round-button subtle" data-action="month-prev" aria-label="Previous month">${icon('back')}</button><h2>${esc(monthTitle)}</h2><button class="round-button subtle" data-action="month-next" aria-label="Next month">${icon('forward')}</button><button class="today-link" data-action="month-today">TODAY</button></div><div class="calendar-grid" role="grid" aria-label="${esc(monthTitle)}"><div class="weekday-row" role="row">${weekdays}</div><div class="day-grid">${dayCells}</div></div><div class="calendar-legend"><span><i class="mark present"></i>ATTENDED</span><span><i class="mark absent">!</i>ABSENT</span><span><i class="mark event">E</i>EVENT</span><span><i class="mark unknown">?</i>UNVERIFIED</span><span><i class="mark deadline">D</i>DEADLINE</span></div><section class="selected-day"><div class="section-title"><div><p class="eyebrow">SELECTED DATE</p><h2>${esc(formatDate(selectedDate))}</h2></div><button class="round-button subtle" data-action="add" data-date="${selectedDate}" aria-label="Add entry for selected date">${icon('plus')}</button></div>${timeline(selectedDate)}</section></main>`;
}

function historyView(): string {
  const entries: Array<{ date: string; start?: string; kind: string; title: string; status?: string; subjectId?: string; id: string; collection: 'attendance' | 'events' | 'notes' }> = [
    ...data.attendance.map((item) => ({ date: item.date, start: item.start, kind: item.type ?? 'class', title: item.title || subjectName(item.subjectId), subjectId: item.subjectId, status: item.status, id: item.id, collection: 'attendance' as const })),
    ...data.events.map((item) => ({ date: item.date, start: item.start, kind: item.type, title: item.title, status: undefined, subjectId: undefined, id: item.id, collection: 'events' as const })),
    ...data.notes.map((item) => ({ date: item.date, start: undefined, kind: 'note', title: item.text, status: undefined, subjectId: undefined, id: item.id, collection: 'notes' as const })),
  ].filter((item) => (!searchTerm || `${item.title} ${item.kind} ${item.date} ${item.status ?? ''} ${item.subjectId ? subjectName(item.subjectId) : ''}`.toLowerCase().includes(searchTerm.toLowerCase())) && (historyFilter === 'all' || item.kind === historyFilter || item.status === historyFilter) && (!historyFrom || item.date >= historyFrom) && (!historyTo || item.date <= historyTo) && (!historySubject || item.subjectId === historySubject)).sort((a, b) => b.date.localeCompare(a.date) || (b.start ?? '').localeCompare(a.start ?? ''));
  const options = data.subjects.map((subject) => `<option value="${subject.id}" ${historySubject === subject.id ? 'selected' : ''}>${esc(subject.name)}</option>`).join('');
  const filters = `<select id="history-filter" aria-label="Filter by type or attendance status"><option value="all">All activity</option>${[['present','Present'],['absent','Absent'],['assignment','Assignments'],['deadline','Deadlines'],['college-event','Events'],['workshop','Workshops'],['lecture','Lectures'],['lab','Labs'],['note','Notes'],['other','Other activity']].map(([value, label]) => `<option value="${value}" ${historyFilter === value ? 'selected' : ''}>${label}</option>`).join('')}</select>`;
  const rows = entries.map((entry) => {
    const label = entry.collection === 'attendance' ? `${subjectName(entry.subjectId ?? '')} / ${entry.status ? statusLabel[entry.status as AttendanceRecord['status']] : 'UNVERIFIED'}` : eventLabel[entry.kind as ActivityType] ?? 'NOTE';
    return `<article class="history-row"><time><strong>${esc(entry.date.slice(8))}</strong><span>${esc(formatDate(entry.date, { month: 'short', year: 'numeric' }).toUpperCase())}</span></time><div class="history-copy"><span class="eyebrow">${esc(label)}</span><h2>${esc(entry.title)}</h2>${entry.start ? `<span class="muted">${esc(entry.start)}</span>` : ''}</div><div class="row-actions">${entry.collection !== 'attendance' ? `<button class="icon-button" data-action="edit-${entry.collection === 'events' ? 'event' : 'note'}" data-id="${entry.id}" aria-label="Edit entry">${icon('edit')}</button>` : ''}<button class="icon-button danger" data-action="delete-entry" data-id="${entry.id}" data-collection="${entry.collection}" aria-label="Delete entry">${icon('trash')}</button></div></article>`;
  }).join('');
  return `${header('HISTORY', 'THE THINGS YOU WANT TO REMEMBER')}<main class="content"><div class="history-tools"><label class="search-field">${icon('search')}<input type="search" id="history-search" value="${esc(searchTerm)}" placeholder="Search dates, subjects, notes…" aria-label="Search history"/></label>${filters}<label>From<input id="history-from" type="date" value="${historyFrom}"/></label><label>To<input id="history-to" type="date" value="${historyTo}"/></label><select id="history-subject" aria-label="Filter by subject"><option value="">All subjects</option>${options}</select></div><p class="result-count">${entries.length} RECORDED ${entries.length === 1 ? 'ENTRY' : 'ENTRIES'} · NEWEST FIRST</p>${rows ? `<div class="history-list">${rows}</div>` : '<div class="empty-state compact"><span class="empty-mark">⌕</span><h3>No matching entries.</h3><p>Your history is built from the records you add.</p><button class="button-quiet" data-action="add">ADD AN ENTRY</button></div>'}</main>`;
}

function recordsView(): string {
  const summary = summarize(data.attendance);
  const subjects = summarizeBySubject(data.attendance, data.subjects);
  const levelFor = (percentage: number | null) => alertLevel(percentage, data.settings.minimum, data.settings.buffer);
  const warnings = subjects.filter(({ summary: item }) => item.percentage !== null && levelFor(item.percentage) !== 'safe');
  const unknown = data.attendance.filter((item) => item.status === 'unknown');
  const conflicts = data.official.filter((official) => {
    const personal = data.attendance.find((item) => item.date === official.date && (official.subjectId ? item.subjectId === official.subjectId : subjectName(item.subjectId).toLowerCase() === official.subjectName.toLowerCase()));
    return personal && personal.status !== 'unknown' && personal.status !== 'cancelled' && personal.status !== official.status;
  });
  let missingExpected = 0;
  const existingIds = new Set(data.attendance.map((item) => item.id));
  if (data.settings.semesterStart && data.settings.semesterEnd && data.settings.semesterStart <= today) {
    const through = data.settings.semesterEnd < today ? data.settings.semesterEnd : today;
    const holidayDates = new Set(data.holidays.map((item) => item.date));
    for (let date = data.settings.semesterStart; date <= through; date = addDays(date, 1)) {
      if (holidayDates.has(date)) continue;
      const [y, m, d] = date.split('-').map(Number);
      const weekday = new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay();
      for (const entry of data.timetable) if (entry.active && entry.weekday === weekday && !existingIds.has(`${entry.id}@${date}`)) missingExpected += 1;
    }
  }
  const warningRows = warnings.map(({ subject, summary: item }) => {
    const level = levelFor(item.percentage);
    const recovery = level === 'critical' ? recoveryClasses(item.present, item.absent, data.settings.minimum / 100) : 0;
    const projection = level !== 'critical' ? '' : recovery === null ? 'No finite projection' : `${recovery} classes to recover*`;
    return `<div class="alert-row ${level}"><span class="alert-symbol">${level === 'critical' ? '!' : '·'}</span><div><strong>${esc(subject.name)}</strong><span>${item.percentage!.toFixed(1)}% personal · ${level.toUpperCase()}</span></div><span class="recovery">${projection}</span></div>`;
  }).join('');
  const subjectRows = subjects.map(({ subject, summary: item }) => {
    const level = levelFor(item.percentage);
    const percent = item.percentage === null ? '—' : `${item.percentage.toFixed(1)}%`;
    const label = item.percentage === null ? 'NO RECORDS' : level.toUpperCase();
    return `<article class="subject-row"><div><h3>${esc(subject.name)}</h3><span>${item.present} PRESENT · ${item.absent} ABSENT · ${item.unknown} UNVERIFIED</span></div><strong>${percent}</strong><i class="subject-state ${item.percentage === null ? '' : level}">${label}</i></article>`;
  }).join('');
  const attention = warnings.length ? `<section class="alert-list"><p class="eyebrow">NEEDS ATTENTION</p>${warningRows}<p class="footnote">* Projection assumes every future class is attended. College rules may differ.</p></section>` : '';
  const bySubject = subjectRows ? `<div class="subject-list">${subjectRows}</div>` : '<div class="empty-inline">No subjects yet. <button class="text-button" data-view="timetable">Set up your timetable</button></div>';
  return `${header('RECORDS', 'PERSONAL ATTENDANCE / OFFICIAL OBSERVATIONS')}<main class="content"><section class="overall-record"><div><span class="eyebrow">OVERALL PERSONAL ATTENDANCE</span><strong>${summary.percentage === null ? '—' : `${summary.percentage.toFixed(1)}%`}</strong><p>${summary.present} present <span>·</span> ${summary.absent} absent <span>·</span> ${summary.unknown} unverified</p></div><span class="tag">MINIMUM ${data.settings.minimum}%</span></section>${attention}<section class="section-block"><div class="section-title"><h2>BY SUBJECT</h2><button class="text-button" data-view="timetable">MANAGE TIMETABLE ↗</button></div>${bySubject}</section><section class="section-block"><div class="section-title"><h2>RECORD CHECK</h2></div><div class="check-grid"><div><strong>${unknown.length}</strong><span>UNVERIFIED CLASSES</span></div><div><strong>${conflicts.length}</strong><span>OFFICIAL CONFLICTS</span></div><div><strong>${missingExpected}</strong><span>MISSING EXPECTED</span></div><div><strong>${data.official.length}</strong><span>OFFICIAL OBSERVATIONS</span></div></div>${missingExpected ? '<button class="text-button" data-action="generate-schedule">GENERATE MISSING CLASS RECORDS ↗</button>' : ''}</section><section class="section-block"><div class="section-title"><h2>TRANSFER DATA</h2></div><p class="body-copy">Records stay in this browser. Export a backup regularly; browser storage is not a substitute for a backup.</p><div class="action-grid"><button class="button-outline" data-action="backup">${icon('download')} BACK UP JSON</button><button class="button-outline" data-action="restore">${icon('upload')} RESTORE BACKUP</button><button class="button-outline" data-action="csv-export">${icon('download')} EXPORT ATTENDANCE CSV</button><button class="button-outline" data-action="csv-template">${icon('download')} SAMPLE CSV TEMPLATE</button><button class="button-outline" data-action="csv-import">${icon('upload')} IMPORT OFFICIAL CSV</button></div></section></main>`;
}

function settingsView(): string {
  const permission = 'Notification' in window ? `Browser permission: ${Notification.permission}` : 'Notifications are not supported in this browser.';
  return `${header('SETTINGS', 'PREFERENCES / LOCAL DATA')}<main class="content"><form id="settings-form" class="settings-form"><section class="section-block"><div class="section-title"><h2>ATTENDANCE RULES</h2></div><div class="form-grid"><label>Minimum attendance %<input type="number" name="minimum" min="1" max="100" value="${data.settings.minimum}" required/></label><label>Warning buffer in points<input type="number" name="buffer" min="0" max="50" value="${data.settings.buffer}" required/></label></div><p class="form-hint">Safe begins at ${data.settings.minimum + data.settings.buffer}%. Warning runs from ${data.settings.minimum}% to ${data.settings.minimum + data.settings.buffer}%.</p></section><section class="section-block"><div class="section-title"><h2>NOTIFICATIONS</h2></div><label class="check-label"><input type="checkbox" name="notificationsEnabled" ${data.settings.notificationsEnabled ? 'checked' : ''}/> Enable browser notifications</label><label class="check-label"><input type="checkbox" name="recoveryNotifications" ${data.settings.recoveryNotifications ? 'checked' : ''}/> Tell me when a subject recovers</label><label class="check-label"><input type="checkbox" name="dailySummary" ${data.settings.dailySummary ? 'checked' : ''}/> Send a best effort daily summary when Attendance Tracker is open</label><div class="form-grid"><label>Repeat alert cooldown in hours<input type="number" name="cooldownHours" min="1" max="720" value="${data.settings.cooldownHours}"/></label><label>Preferred reminder time<input type="time" name="reminderTime" value="${esc(data.settings.reminderTime)}"/></label></div><p class="form-hint">A service worker on GitHub Pages cannot reliably wake while Android has suspended the app. Browser notifications require permission and an active app session.</p><button class="button-outline" type="button" data-action="notification-permission">ALLOW NOTIFICATIONS</button><span class="permission-state">${permission}</span></section><section class="section-block"><div class="section-title"><h2>SEMESTER</h2></div><div class="form-grid"><label>Semester start<input type="date" name="semesterStart" value="${esc(data.settings.semesterStart)}"/></label><label>Semester end<input type="date" name="semesterEnd" value="${esc(data.settings.semesterEnd)}"/></label></div></section><button class="button-primary" type="submit">SAVE SETTINGS <span>↗</span></button></form><section class="section-block"><div class="section-title"><h2>LOCAL STORAGE</h2></div><p class="body-copy">Your records are stored only in this browser on this device. Use backup and restore in Records to move them safely.</p><button class="button-quiet" data-action="storage-persist">REQUEST PROTECTED STORAGE</button></section></main>`;
}

function timetableView(): string {
  const subjectOptions = data.subjects.map((subject) => `<option value="${subject.id}">${esc(subject.name)}</option>`).join('');
  const subjects = data.subjects.length ? `<div class="subject-list">${data.subjects.map((subject) => `<article class="subject-row"><div><h3>${esc(subject.name)}</h3><span>${data.timetable.filter((entry) => entry.subjectId === subject.id && entry.active).length} WEEKLY SESSIONS</span></div><button class="icon-button danger" data-action="delete-subject" data-id="${subject.id}" aria-label="Delete ${esc(subject.name)}">${icon('trash')}</button></article>`).join('')}</div>` : '<p class="form-hint">Add your subjects first, then create weekly class slots.</p>';
  const scheduleRows = [...data.timetable].sort((a, b) => a.weekday - b.weekday || a.start.localeCompare(b.start)).map((entry) => `<article class="schedule-row"><span>${['SUN','MON','TUE','WED','THU','FRI','SAT'][entry.weekday]}</span><div><strong>${esc(subjectName(entry.subjectId))}</strong><small>${esc(entry.start)}–${esc(entry.end)}${entry.room ? ` · ${esc(entry.room)}` : ''}</small></div><button class="icon-button danger" data-action="delete-schedule" data-id="${entry.id}" aria-label="Remove future schedule">${icon('trash')}</button></article>`).join('');
  const holidays = [...data.holidays].sort((a,b) => a.date.localeCompare(b.date)).map((item) => `<article class="schedule-row"><span>${esc(item.date)}</span><div><strong>${esc(item.name)}</strong></div><button class="icon-button danger" data-action="delete-holiday" data-id="${item.id}" aria-label="Delete holiday">${icon('trash')}</button></article>`).join('');
  return `${header('TIMETABLE', 'SUBJECTS / WEEKLY SCHEDULE')}<main class="content"><section class="section-block"><div class="section-title"><h2>SUBJECTS</h2></div><form id="subject-form" class="inline-form"><label class="grow">Subject name<input name="name" required maxlength="60" placeholder="e.g. Applied Physics"/></label><button class="button-primary" type="submit">ADD SUBJECT <span>＋</span></button></form>${subjects}</section><section class="section-block"><div class="section-title"><h2>WEEKLY CLASS</h2></div><form id="timetable-form" class="schedule-form"><label>Subject<select name="subjectId" required ${data.subjects.length ? '' : 'disabled'}><option value="">Choose a subject</option>${subjectOptions}</select></label><label>Weekday<select name="weekday"><option value="1">Monday</option><option value="2">Tuesday</option><option value="3">Wednesday</option><option value="4">Thursday</option><option value="5">Friday</option><option value="6">Saturday</option><option value="0">Sunday</option></select></label><div class="form-grid"><label>Starts<input type="time" name="start" required value="09:00"/></label><label>Ends<input type="time" name="end" required value="10:00"/></label></div><label>Room / location<input name="room" maxlength="40" placeholder="Optional"/></label><button class="button-primary" type="submit" ${data.subjects.length ? '' : 'disabled'}>ADD WEEKLY CLASS <span>＋</span></button></form>${scheduleRows ? `<div class="schedule-list">${scheduleRows}</div>` : ''}</section><section class="section-block"><div class="section-title"><h2>HOLIDAYS & NON-TEACHING DAYS</h2></div><form id="holiday-form" class="inline-form"><label>Date<input type="date" name="date" required/></label><label class="grow">Day off<input name="name" required maxlength="80"/></label><button class="button-primary" type="submit">ADD DAY OFF <span>＋</span></button></form>${holidays ? `<div class="schedule-list">${holidays}</div>` : ''}<p class="form-hint">Adding a holiday prevents future generation on that date. Existing class records remain unchanged.</p></section><button class="button-outline" data-action="generate-schedule">GENERATE UPCOMING CLASSES</button></main>`;
}

function render(): void {
  if (!data) return;
  const body = view === 'today' ? todayView() : view === 'calendar' ? calendarView() : view === 'history' ? historyView() : view === 'records' ? recordsView() : view === 'settings' ? settingsView() : timetableView();
  root.innerHTML = `<div class="app-shell">${body}${nav()}<div id="dialog-host"></div></div>`;
}

function showDialog(title: string, body: string, className = ''): HTMLDialogElement {
  const host = document.querySelector<HTMLDivElement>('#dialog-host')!;
  host.innerHTML = `<dialog class="modal ${className}"><div class="modal-header"><div><p class="eyebrow">ATTENDANCE TRACKER / LOCAL ENTRY</p><h2>${esc(title)}</h2></div><button class="round-button subtle" type="button" data-action="close-dialog" aria-label="Close">${icon('close')}</button></div>${body}</dialog>`;
  const dialog = host.querySelector('dialog')!;
  dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); });
  dialog.addEventListener('close', () => { host.innerHTML = ''; });
  dialog.showModal();
  return dialog;
}

function addDialog(date = selectedDate, initialKind = ''): void {
  const kind = initialKind || 'class';
  const subjectOptions = data.subjects.map((subject) => `<option value="${subject.id}">${esc(subject.name)}</option>`).join('');
  const kinds: Array<[string, string]> = [['class','Class / attendance'], ['college-event','College event'], ['workshop','Workshop'], ['assignment','Assignment'], ['deadline','Deadline'], ['note','Daily note'], ['other','Other activity'], ['schedule-change','One-off schedule change']];
  const dialog = showDialog('ADD TO YOUR DAY', `<form id="add-form" class="modal-form"><label>Entry type<select name="kind" id="add-kind">${kinds.map(([value, label]) => `<option value="${value}" ${kind === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label><div class="kind-fields" id="kind-fields"></div><div class="modal-actions"><button type="button" class="button-quiet" data-action="close-dialog">CANCEL</button><button class="button-primary" type="submit">SAVE ENTRY <span>↗</span></button></div></form>`);
  const fill = (): void => {
    const form = dialog.querySelector<HTMLFormElement>('#add-form')!;
    const selected = (form.elements.namedItem('kind') as HTMLSelectElement).value;
    const fields = dialog.querySelector<HTMLDivElement>('#kind-fields')!;
    const dateField = `<label>Date<input type="date" name="date" required value="${esc(date)}"/></label>`;
    if (selected === 'class' || selected === 'schedule-change') {
      fields.innerHTML = `${dateField}<label>Subject<select name="subjectId" required><option value="">${data.subjects.length ? 'Choose a subject' : 'Add a subject in Timetable first'}</option>${subjectOptions}</select></label><label>Class type<select name="classType"><option value="lecture">Lecture</option><option value="lab">Lab</option><option value="workshop">Workshop</option><option value="other">Other</option></select></label><div class="form-grid"><label>Starts<input type="time" name="start" value="09:00" required/></label><label>Ends<input type="time" name="end" value="10:00" required/></label></div><label>Room<input name="room"/></label><label>Starting status<select name="status"><option value="unknown">Unverified</option><option value="present">Present</option><option value="absent">Absent</option><option value="cancelled">Cancelled</option></select></label>`;
    } else if (selected === 'note') fields.innerHTML = `${dateField}<label>Daily note<textarea name="text" rows="5" maxlength="3000" required placeholder="What do you want to remember?"></textarea></label>`;
    else fields.innerHTML = `${dateField}<label>Title<input name="title" maxlength="120" required placeholder="Give this entry a name"/></label><div class="form-grid"><label>Starts (optional)<input type="time" name="start"/></label><label>Ends (optional)<input type="time" name="end"/></label></div><label>Description (optional)<textarea name="description" rows="3" maxlength="2000"></textarea></label>`;
  };
  dialog.querySelector('#add-kind')!.addEventListener('change', fill);
  fill();
}

function editDialog(collection: 'events' | 'notes', itemId: string): void {
  if (collection === 'events') {
    const item = data.events.find((event) => event.id === itemId);
    if (!item) return;
    showDialog('EDIT ACTIVITY', `<form id="edit-event-form" data-id="${item.id}" class="modal-form"><label>Date<input type="date" name="date" required value="${item.date}"/></label><label>Type<select name="type">${Object.entries(eventLabel).map(([key,label]) => `<option value="${key}" ${item.type === key ? 'selected' : ''}>${label}</option>`).join('')}</select></label><label>Title<input name="title" required maxlength="120" value="${esc(item.title)}"/></label><div class="form-grid"><label>Starts<input type="time" name="start" value="${item.start ?? ''}"/></label><label>Ends<input type="time" name="end" value="${item.end ?? ''}"/></label></div><label>Description<textarea name="description" rows="3">${esc(item.description ?? '')}</textarea></label><div class="modal-actions"><button type="button" class="button-quiet" data-action="close-dialog">CANCEL</button><button class="button-primary">SAVE CHANGES <span>↗</span></button></div></form>`);
  } else {
    const item = data.notes.find((note) => note.id === itemId);
    if (!item) return;
    showDialog('EDIT DAILY NOTE', `<form id="edit-note-form" data-id="${item.id}" class="modal-form"><label>Date<input type="date" name="date" required value="${item.date}"/></label><label>Note<textarea name="text" rows="6" maxlength="3000" required>${esc(item.text)}</textarea></label><div class="modal-actions"><button type="button" class="button-quiet" data-action="close-dialog">CANCEL</button><button class="button-primary">SAVE CHANGES <span>↗</span></button></div></form>`);
  }
}

function download(name: string, contents: string, type: string): void {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function uploadDialog(kind: 'restore' | 'csv'): void {
  if (kind === 'restore') {
    const dialog = showDialog('RESTORE A BACKUP', `<form id="restore-form" class="modal-form"><label>Choose an Attendance Tracker JSON backup<input type="file" name="file" accept="application/json,.json" required/></label><div id="restore-preview" class="preview-box">Choose a file to inspect its contents before restoring.</div><label>Restore method<select name="mode"><option value="merge">Merge with this device</option><option value="replace">Replace all current data</option></select></label><p class="form-hint">Restore is applied in one database transaction. Replace erases current browser data after confirmation.</p><div class="modal-actions"><button type="button" class="button-quiet" data-action="close-dialog">CANCEL</button><button class="button-primary" id="restore-submit" disabled>RESTORE DATA <span>↗</span></button></div></form>`);
    dialog.querySelector<HTMLInputElement>('input[type=file]')!.addEventListener('change', async (event) => {
      const file = (event.currentTarget as HTMLInputElement).files?.[0]; if (!file) return;
      try {
        const parsed = parseBackup(await file.text());
        dialog.dataset.backup = JSON.stringify(parsed);
        dialog.querySelector('#restore-preview')!.textContent = `${parsed.subjects.length} subjects · ${parsed.attendance.length} class records · ${parsed.events.length} activities · exported ${new Date(parsed.exportedAt).toLocaleString()}`;
        dialog.querySelector<HTMLButtonElement>('#restore-submit')!.disabled = false;
      } catch (error) { dialog.querySelector('#restore-preview')!.textContent = error instanceof Error ? error.message : 'Could not read backup.'; }
    });
    return;
  }
  const dialog = showDialog('IMPORT OFFICIAL CSV', `<form id="csv-form" class="modal-form"><label>Choose your college CSV export<input type="file" name="file" accept=".csv,text/csv" required/></label><p class="form-hint">Dates use YYYY-MM-DD. Status values include Present/Absent, P/A, Attended/Missed, Yes/No, or 1/0.</p><div id="csv-mapping"></div><div id="csv-preview" class="preview-box">Select a file to map its columns.</div><div class="modal-actions"><button type="button" class="button-quiet" data-action="close-dialog">CANCEL</button><button class="button-primary" id="csv-submit" disabled>IMPORT OFFICIAL RECORDS <span>↗</span></button></div></form>`);
  const fileInput = dialog.querySelector<HTMLInputElement>('input[type=file]')!;
  let rows: string[][] = [];
  const buildPreview = (): void => {
    const selects = [...dialog.querySelectorAll<HTMLSelectElement>('[data-map]')];
    if (selects.length !== 3) return;
    const mapping = Object.fromEntries(selects.map((select) => [select.dataset.map!, Number(select.value)]) as [string, number][]) as unknown as CsvMapping;
    const preview = mapOfficialCsv(rows, mapping, data.subjects, data.attendance, data.official);
    dialog.dataset.preview = JSON.stringify(preview);
    const ready = preview.filter((item) => !item.issue && !item.duplicate).length;
    const conflicts = preview.filter((item) => item.personal && item.status && item.personal.status !== 'unknown' && item.personal.status !== 'cancelled' && item.personal.status !== item.status).length;
    const list = preview.slice(0, 6).map((item) => `<span>${esc(item.date)} · ${esc(item.subjectName)} · ${esc(item.status ?? 'unknown')} ${item.issue ? `— ${esc(item.issue)}` : item.duplicate ? '— duplicate row' : item.personal && item.status !== item.personal.status ? '— differs from personal record' : ''}</span>`).join('');
    dialog.querySelector('#csv-preview')!.innerHTML = `<strong>${ready} ready</strong> / ${preview.length} rows · ${conflicts} personal conflict${conflicts === 1 ? '' : 's'}<div class="preview-list">${list}</div>${preview.length > 6 ? `<small>and ${preview.length - 6} more rows</small>` : ''}`;
    dialog.querySelector<HTMLButtonElement>('#csv-submit')!.disabled = ready === 0;
  };
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0]; if (!file) return;
    try {
      rows = parseCsv(await file.text());
      const headers = rows[0]!;
      const guess = (pattern: RegExp, fallback: number): number => { const index = headers.findIndex((header) => pattern.test(header.toLowerCase())); return index < 0 ? fallback : index; };
      const mapping: Record<string, number> = { date: guess(/date/, 0), subject: guess(/subject|course|class/, Math.min(1, headers.length - 1)), status: guess(/status|attendance|present/, Math.min(2, headers.length - 1)) };
      const control = (key: string, label: string): string => `<label>${label}<select data-map="${key}">${headers.map((header, index) => `<option value="${index}" ${mapping[key] === index ? 'selected' : ''}>${esc(header || `Column ${index + 1}`)}</option>`).join('')}</select></label>`;
      dialog.querySelector('#csv-mapping')!.innerHTML = `<div class="form-grid mapping-grid">${control('date','Date column')}${control('subject','Subject column')}${control('status','Status column')}</div>`;
      dialog.querySelectorAll('[data-map]').forEach((element) => element.addEventListener('change', buildPreview));
      buildPreview();
    } catch (error) { dialog.querySelector('#csv-preview')!.textContent = error instanceof Error ? error.message : 'Could not read CSV.'; }
  });
}

async function evaluateNotifications(): Promise<void> {
  if (!data.settings.notificationsEnabled) return;
  const notices = collectNotices(data.subjects, data.attendance, data.settings.minimum, data.settings.buffer, data.notifications, new Date(), data.settings.cooldownHours);
  const current = summarizeBySubject(data.attendance, data.subjects);
  for (const { subject, summary } of current) {
    if (summary.percentage === null) continue;
    const level = alertLevel(summary.percentage, data.settings.minimum, data.settings.buffer);
    const previous = data.notifications.find((item) => item.subjectId === subject.id);
    if (level === 'warning' && previous?.level === 'critical') {
      await put('notifications', { ...previous, level: 'warning', percentage: summary.percentage, updatedAt: nowIso() });
    }
    if (level === 'safe' && previous && previous.level !== 'safe') {
      if (data.settings.recoveryNotifications && 'Notification' in window && Notification.permission === 'granted') sendBrowserNotice({ subjectId: subject.id, level: 'safe', percentage: summary.percentage, title: 'Attendance recovered', body: `${subject.name} is now above your warning threshold.` });
      await put('notifications', { ...previous, level: 'safe', percentage: summary.percentage, updatedAt: nowIso() });
    }
  }
  for (const notice of notices) {
    const previous = data.notifications.find((item) => item.subjectId === notice.subjectId);
    if ('Notification' in window && Notification.permission === 'granted') sendBrowserNotice(notice);
    await put('notifications', { id: notice.subjectId, subjectId: notice.subjectId, level: notice.level, percentage: notice.percentage, lastSentAt: nowIso(), episode: (previous?.episode ?? 0) + (previous?.level === 'safe' || !previous ? 1 : 0) });
  }
  if (data.settings.dailySummary && 'Notification' in window && Notification.permission === 'granted') {
    const [hour, minute] = data.settings.reminderTime.split(':').map(Number);
    const now = new Date(); const target = (hour ?? 18) * 60 + (minute ?? 0); const currentMinute = now.getHours() * 60 + now.getMinutes();
    const key = `daily-summary-${today}`;
    if (Math.abs(currentMinute - target) <= 30 && !data.notifications.some((item) => item.id === key)) {
      const critical = current.filter(({ summary }) => summary.percentage !== null && alertLevel(summary.percentage, data.settings.minimum, data.settings.buffer) === 'critical');
      const body = critical.length ? `${critical.map(({ subject }) => subject.name).join(', ')} need${critical.length === 1 ? 's' : ''} attention.` : 'Your attendance is up to date.';
      sendBrowserNotice({ subjectId: key, level: 'safe', percentage: 100, title: 'Attendance Tracker daily summary', body });
      await put('notifications', { id: key, subjectId: key, level: 'safe', percentage: 100, lastSentAt: nowIso(), episode: 1 });
    }
  }
  await refresh();
}

async function generateUpcoming(): Promise<number> {
  if (!data.settings.semesterStart || !data.settings.semesterEnd) throw new Error('Set semester start and end dates in Settings first.');
  if (data.settings.semesterEnd < data.settings.semesterStart) throw new Error('Semester end must be after its start.');
  const generated = data.timetable.flatMap((entry) => generateSchedule({ entry, startDate: data.settings.semesterStart, endDate: data.settings.semesterEnd, holidays: data.holidays, existing: data.attendance }));
  await putMany('attendance', generated); await refresh(); render(); return generated.length;
}

function openMenu(): void {
  showDialog('ATTENDANCE TRACKER', `<div class="menu-list"><button data-view="timetable">TIMETABLE & SUBJECTS <span>↗</span></button><button data-view="settings">SETTINGS <span>↗</span></button><button data-action="backup">BACK UP YOUR DATA <span>↗</span></button><p>Local first. Your records stay in this browser.</p></div>`);
}

function handleClick(event: MouseEvent): void {
  const control = (event.target as HTMLElement).closest<HTMLElement>('[data-action], [data-view]');
  if (!control) return;
  const action = control.dataset.action;
  const requestedView = control.dataset.view as View | undefined;
  if (requestedView) { view = requestedView; data.settings = { ...data.settings, selectedView: requestedView }; void put('settings', data.settings).then(render); return; }
  if (!action) return;
  if (action === 'add') { addDialog(control.dataset.date ?? (view === 'today' ? today : selectedDate), control.dataset.kind ?? ''); return; }
  if (action === 'menu') { openMenu(); return; }
  if (action === 'close-dialog') { document.querySelector<HTMLDialogElement>('dialog[open]')?.close(); return; }
  if (action === 'select-date') { selectedDate = control.dataset.date!; render(); return; }
  if (action === 'month-prev' || action === 'month-next') { [year, month] = moveMonth(year, month, action === 'month-prev' ? -1 : 1); render(); return; }
  if (action === 'month-today') { year = new Date().getFullYear(); month = new Date().getMonth(); selectedDate = today; render(); return; }
  if (action === 'status') {
    const record = data.attendance.find((item) => item.id === control.dataset.id); if (!record) return;
    const updated = updateAttendance(record, control.dataset.status as AttendanceRecord['status']);
    void put('attendance', updated).then(async () => { data.attendance = data.attendance.map((item) => item.id === updated.id ? updated : item); render(); flash('Attendance saved.'); await evaluateNotifications(); }).catch((error: unknown) => flash(error instanceof Error ? error.message : 'Attendance could not be saved.'));
    return;
  }
  if (action === 'edit-event') { editDialog('events', control.dataset.id!); return; }
  if (action === 'edit-note') { editDialog('notes', control.dataset.id!); return; }
  if (action === 'delete-entry') {
    const collection = control.dataset.collection as 'attendance' | 'events' | 'notes';
    if (!window.confirm('Delete this entry? This cannot be undone.')) return;
    void remove(collection, control.dataset.id!).then(async () => { await refresh(); render(); flash('Entry deleted.'); }).catch((error: unknown) => flash(error instanceof Error ? error.message : 'Entry could not be deleted.'));
    return;
  }
  if (action === 'delete-subject') {
    const subjectId = control.dataset.id!;
    if (data.attendance.some((item) => item.subjectId === subjectId) || data.timetable.some((item) => item.subjectId === subjectId)) { flash('This subject has class history. Keep it so those records stay linked.'); return; }
    if (!window.confirm('Remove this subject?')) return;
    void remove('subjects', subjectId).then(async () => { await refresh(); render(); }); return;
  }
  if (action === 'delete-schedule') {
    if (!window.confirm('Remove this weekly schedule? Existing class records are preserved.')) return;
    void remove('timetable', control.dataset.id!).then(async () => { await refresh(); render(); flash('Weekly schedule removed. Existing records were kept.'); }); return;
  }
  if (action === 'delete-holiday') { if (!window.confirm('Remove this holiday?')) return; void remove('holidays', control.dataset.id!).then(async () => { await refresh(); render(); }); return; }
  if (action === 'backup') { void loadBackupData().then((backup) => download(`attendance-tracker-backup-${today}.json`, JSON.stringify(createBackup(backup), null, 2), 'application/json')); document.querySelector<HTMLDialogElement>('dialog[open]')?.close(); return; }
  if (action === 'restore') { uploadDialog('restore'); return; }
  if (action === 'csv-import') { uploadDialog('csv'); return; }
  if (action === 'csv-export') {
    const lines = [['date','subject','start','end','status','room'], ...data.attendance.map((item) => [item.date, subjectName(item.subjectId), item.start, item.end, item.status, item.room ?? ''])];
    download(`attendance-tracker-attendance-${today}.csv`, lines.map((row) => row.map(csvEscape).join(',')).join('\r\n'), 'text/csv'); return;
  }
  if (action === 'csv-template') { download('attendance-tracker-official-template.csv', 'date,subject,status\r\n2026-09-01,Mathematics,Present\r\n2026-09-02,Physics,Absent\r\n', 'text/csv'); return; }
  if (action === 'notification-permission') { void requestNotificationPermission().then((permission) => { flash(permission === 'unsupported' ? 'Notifications are not supported here.' : `Notification permission: ${permission}.`); render(); }); return; }
  if (action === 'storage-persist') { void requestStoragePersistence().then((granted) => flash(granted ? 'Browser storage is protected from automatic cleanup.' : 'The browser did not grant protected storage. Keep a backup.')); return; }
  if (action === 'generate-schedule') { void generateUpcoming().then((count) => flash(`${count} upcoming class${count === 1 ? '' : 'es'} generated.`)).catch((error: unknown) => flash(error instanceof Error ? error.message : 'Could not generate timetable.')); }
}

async function submitSettings(form: HTMLFormElement): Promise<void> {
  const fields = new FormData(form);
  const minimum = Number(fields.get('minimum')); const buffer = Number(fields.get('buffer'));
  const cooldownHours = Number(fields.get('cooldownHours'));
  if (!Number.isFinite(minimum) || minimum < 1 || minimum > 100 || !Number.isFinite(buffer) || buffer < 0 || buffer > 50) throw new Error('Enter a minimum from 1–100 and a warning buffer from 0–50.');
  const semesterStart = String(fields.get('semesterStart') || ''); const semesterEnd = String(fields.get('semesterEnd') || '');
  if (semesterStart && semesterEnd && semesterEnd < semesterStart) throw new Error('Semester end must be on or after its start.');
  data.settings = { ...data.settings, minimum, buffer, cooldownHours: Number.isFinite(cooldownHours) ? Math.min(720, Math.max(1, cooldownHours)) : 24, notificationsEnabled: fields.has('notificationsEnabled'), recoveryNotifications: fields.has('recoveryNotifications'), dailySummary: fields.has('dailySummary'), reminderTime: String(fields.get('reminderTime') || '18:00'), semesterStart, semesterEnd, updatedAt: nowIso() };
  await put('settings', data.settings); render(); flash('Settings saved on this device.'); await evaluateNotifications();
}

async function handleSubmit(event: SubmitEvent): Promise<void> {
  const form = event.target as HTMLFormElement;
  if (!form.matches('form')) return;
  event.preventDefault();
  const fields = new FormData(form);
  try {
    if (form.id === 'add-form') {
      const kind = String(fields.get('kind')) as ActivityType | 'class' | 'schedule-change'; const date = String(fields.get('date'));
      if (kind === 'class' || kind === 'schedule-change') {
        const subjectId = String(fields.get('subjectId') ?? ''); if (!subjectId) throw new Error('Add a subject in Timetable before recording a class.');
        const start = String(fields.get('start')); const end = String(fields.get('end')); if (start >= end) throw new Error('Class end time must be after its start time.');
        const record: AttendanceRecord = { id: id(), date, subjectId, start, end, room: String(fields.get('room') ?? ''), type: String(fields.get('classType') || 'lecture') as ActivityType, scheduleChange: kind === 'schedule-change', status: String(fields.get('status') ?? 'unknown') as AttendanceRecord['status'], source: 'personal', createdAt: nowIso() };
        await put('attendance', record);
      } else if (kind === 'note') await put('notes', { id: id(), date, text: String(fields.get('text')), createdAt: nowIso(), updatedAt: nowIso() });
      else await put('events', { id: id(), date, title: String(fields.get('title')), type: kind, start: String(fields.get('start') || '') || undefined, end: String(fields.get('end') || '') || undefined, description: String(fields.get('description') || '') || undefined, createdAt: nowIso(), updatedAt: nowIso() });
      document.querySelector<HTMLDialogElement>('dialog[open]')?.close(); await refresh(); render(); flash('Entry saved on this device.'); await evaluateNotifications(); return;
    }
    if (form.id === 'edit-event-form') {
      const current = data.events.find((item) => item.id === form.dataset.id)!;
      await put('events', { ...current, date: String(fields.get('date')), title: String(fields.get('title')), type: String(fields.get('type')) as ActivityType, start: String(fields.get('start') || '') || undefined, end: String(fields.get('end') || '') || undefined, description: String(fields.get('description') || '') || undefined, updatedAt: nowIso() });
      document.querySelector<HTMLDialogElement>('dialog[open]')?.close(); await refresh(); render(); flash('Activity updated.'); return;
    }
    if (form.id === 'edit-note-form') {
      const current = data.notes.find((item) => item.id === form.dataset.id)!;
      await put('notes', { ...current, date: String(fields.get('date')), text: String(fields.get('text')), updatedAt: nowIso() });
      document.querySelector<HTMLDialogElement>('dialog[open]')?.close(); await refresh(); render(); flash('Note updated.'); return;
    }
    if (form.id === 'settings-form') { await submitSettings(form); return; }
    if (form.id === 'subject-form') {
      const name = String(fields.get('name')).trim(); if (data.subjects.some((subject) => subject.name.toLowerCase() === name.toLowerCase())) throw new Error('That subject already exists.');
      await put('subjects', { id: id(), name, color: '#e50920', createdAt: nowIso() }); await refresh(); render(); flash('Subject added.'); return;
    }
    if (form.id === 'timetable-form') {
      const start = String(fields.get('start')); const end = String(fields.get('end')); if (start >= end) throw new Error('Class end time must be after its start time.');
      await put('timetable', { id: id(), subjectId: String(fields.get('subjectId')), weekday: Number(fields.get('weekday')), start, end, room: String(fields.get('room') || ''), active: true, createdAt: nowIso() }); await refresh(); render(); flash('Weekly class added.'); return;
    }
    if (form.id === 'holiday-form') {
      const date = String(fields.get('date')); const existing = data.attendance.filter((item) => item.date === date);
      if (existing.length && !window.confirm(`${existing.length} class record${existing.length === 1 ? '' : 's'} already exist on this date. Keep those records and add the holiday?`)) return;
      await put('holidays', { id: id(), date, name: String(fields.get('name')), createdAt: nowIso() }); await refresh(); render(); flash('Holiday saved. Existing records were preserved.'); return;
    }
    if (form.id === 'restore-form') {
      const incoming = parseBackup(form.closest('dialog')!.dataset.backup ?? ''); const mode = String(fields.get('mode')) as 'merge' | 'replace';
      if (!window.confirm(mode === 'replace' ? 'Replace all current Attendance Tracker data with this backup? This cannot be undone.' : 'Merge this backup into current data? Matching IDs use the backup version.')) return;
      const current = await loadBackupData(); await restoreBackup(mergeBackup(current, incoming, mode), 'replace');
      document.querySelector<HTMLDialogElement>('dialog[open]')?.close(); await refresh(); render(); flash('Backup restored.'); return;
    }
    if (form.id === 'csv-form') {
      const dialog = form.closest('dialog')!; const preview = JSON.parse(dialog.dataset.preview ?? '[]') as CsvPreviewRow[];
      const conflicts = preview.filter((row) => row.personal && row.status && row.personal.status !== 'unknown' && row.personal.status !== 'cancelled' && row.personal.status !== row.status).length;
      const ready = preview.filter((row) => !row.issue && !row.duplicate).length;
      if (!window.confirm(`Import ${ready} official observations? ${conflicts} conflict${conflicts === 1 ? '' : 's'} with personal records will stay separate. No personal attendance will change.`)) return;
      const fileName = form.querySelector<HTMLInputElement>('input[type=file]')?.files?.[0]?.name ?? 'CSV import';
      const observations = preview.map((row) => toOfficialObservation(row, fileName)).filter((item) => item !== null);
      await putMany('official', observations); if (observations.length) await put('imports', { id: id(), fileName, importedAt: nowIso(), count: observations.length });
      document.querySelector<HTMLDialogElement>('dialog[open]')?.close(); await refresh(); render(); flash(`${observations.length} official observation${observations.length === 1 ? '' : 's'} imported. Personal attendance did not change.`); return;
    }
  } catch (error) { flash(error instanceof Error ? error.message : 'Could not save this entry. Please try again.'); }
}

function handleChange(event: Event): void {
  const target = event.target;
  if (target instanceof HTMLSelectElement && target.id === 'history-filter') { historyFilter = target.value; render(); }
  if (target instanceof HTMLSelectElement && target.id === 'history-subject') { historySubject = target.value; render(); }
  if (target instanceof HTMLInputElement && target.id === 'history-from') { historyFrom = target.value; render(); }
  if (target instanceof HTMLInputElement && target.id === 'history-to') { historyTo = target.value; render(); }
  if (target instanceof HTMLInputElement && target.id === 'history-search') {
    searchTerm = target.value; const position = target.selectionStart; render(); const input = document.querySelector<HTMLInputElement>('#history-search'); input?.focus(); input?.setSelectionRange(position, position);
  }
}

async function main(): Promise<void> {
  try {
    await refresh();
    if (!(await getAll('settings')).length) await put('settings', data.settings);
    view = (['today', 'calendar', 'history', 'records', 'settings', 'timetable'] as string[]).includes(data.settings.selectedView) ? data.settings.selectedView as View : 'today';
    if (!data.settings.id) { data.settings = DEFAULT_SETTINGS; await put('settings', data.settings); }
    render();
    void evaluateNotifications().catch((error: unknown) => flash(error instanceof Error ? error.message : 'Could not check attendance alerts.'));
    void requestStoragePersistence().catch(() => false);
    if ('serviceWorker' in navigator && import.meta.env.PROD) {
      void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).then((registration) => {
        if (registration.waiting && navigator.serviceWorker.controller && window.confirm('An Attendance Tracker update is ready. Reload now?')) registration.waiting.postMessage('SKIP_WAITING');
        registration.addEventListener('updatefound', () => {
          const installing = registration.installing;
          installing?.addEventListener('statechange', () => {
            if (installing.state === 'installed' && navigator.serviceWorker.controller && window.confirm('An Attendance Tracker update is ready. Reload now?')) registration.waiting?.postMessage('SKIP_WAITING');
          });
        });
      }).catch((error: unknown) => console.warn('Offline worker could not be registered.', error));
      navigator.serviceWorker.addEventListener('controllerchange', () => window.location.reload(), { once: true });
    }
  } catch (error) {
    root.innerHTML = `<main class="error-screen"><img src="${import.meta.env.BASE_URL}icons/icon-192.png" alt=""/><p class="eyebrow">ATTENDANCE TRACKER / STORAGE ERROR</p><h1>YOUR RECORDS COULD NOT BE OPENED.</h1><p>${esc(error instanceof Error ? error.message : 'Check browser storage and reload the app.')}</p><button class="button-primary" onclick="location.reload()">RELOAD APP <span>↗</span></button></main>`;
  }
}

root.addEventListener('click', handleClick);
root.addEventListener('submit', (event) => void handleSubmit(event));
root.addEventListener('change', handleChange);
root.addEventListener('input', handleChange);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  const currentDate = localDate();
  if (currentDate !== today) { today = currentDate; void refresh().then(render); }
});
void main();

