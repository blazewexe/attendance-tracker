import type { AttendanceRecord, OfficialObservation, Subject } from './domain';

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const input = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < input.length; i += 1) {
    const char = input[i]!;
    if (quoted) {
      if (char === '"' && input[i + 1] === '"') { cell += '"'; i += 1; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') { row.push(cell.trim()); cell = ''; }
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && input[i + 1] === '\n') i += 1;
      row.push(cell.trim()); cell = '';
      if (row.some(Boolean)) rows.push(row);
      row = [];
    } else cell += char;
  }
  if (quoted) throw new Error('CSV contains an unclosed quoted field.');
  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  if (rows.length < 2) throw new Error('CSV needs a header row and at least one record.');
  return rows;
}

export interface CsvMapping { date: number; subject: number; status: number }
export interface CsvPreviewRow { date: string; subjectName: string; subjectId?: string; status?: 'present' | 'absent'; personal?: AttendanceRecord; duplicate: boolean; issue?: string }

function isDateOnly(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const candidate = new Date(Date.UTC(year!, month! - 1, day!));
  return candidate.getUTCFullYear() === year && candidate.getUTCMonth() === month! - 1 && candidate.getUTCDate() === day;
}

export function mapOfficialCsv(rows: string[][], mapping: CsvMapping, subjects: readonly Subject[], attendance: readonly AttendanceRecord[], official: readonly OfficialObservation[] = []): CsvPreviewRow[] {
  const seen = new Set<string>();
  return rows.slice(1).map((row) => {
    const date = row[mapping.date]?.trim() ?? '';
    const subjectName = row[mapping.subject]?.trim() ?? '';
    const rawStatus = row[mapping.status]?.trim().toLowerCase() ?? '';
    const status = /^(present|p|attended|yes|1)$/.test(rawStatus) ? 'present' : /^(absent|a|missed|no|0)$/.test(rawStatus) ? 'absent' : undefined;
    const subject = subjects.find((item) => item.name.toLowerCase() === subjectName.toLowerCase());
    const personal = attendance.find((item) => item.date === date && (subject ? item.subjectId === subject.id : false));
    const key = `${date}|${subject?.id ?? subjectName.toLowerCase()}`;
    const alreadyImported = official.some((item) => item.date === date && (subject ? item.subjectId === subject.id : item.subjectName.toLowerCase() === subjectName.toLowerCase()));
    const duplicate = seen.has(key) || alreadyImported;
    seen.add(key);
    let issue: string | undefined;
    if (!isDateOnly(date)) issue = 'Invalid date (use a real date in YYYY-MM-DD format)';
    else if (!subjectName) issue = 'Missing subject';
    else if (!subject) issue = 'Subject is not configured';
    else if (!status) issue = 'Unknown attendance status';
    return { date, subjectName, subjectId: subject?.id, status, personal, duplicate, issue };
  });
}

export function toOfficialObservation(row: CsvPreviewRow, sourceName: string): OfficialObservation | null {
  if (row.issue || row.duplicate || !row.status) return null;
  return { id: crypto.randomUUID(), date: row.date, subjectId: row.subjectId, subjectName: row.subjectName, status: row.status, sourceName, personalRecordId: row.personal?.id, createdAt: new Date().toISOString() };
}

export function csvEscape(value: string | number): string {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
