# Attendance Tracker

A minimal, offline-first college attendance PWA. Everything is saved locally on your device in IndexedDB — no accounts, no analytics, no backend.

## Getting Started

```sh
npm install
npm run dev
```

Build & test:

```sh
npm test        # run tests
npm run build   # output to dist/
```

## Features

- **Timetable & Calendar** — Set up subjects, recurring slots, and semester dates. Generate class schedules in one click.
- **Attendance Tracking** — Mark classes present, absent, or cancelled. Real-time percentages and target recovery calculations.
- **Official CSV Import** — Import attendance exports from your college portal to cross-check discrepancies.
- **Backups** — Export or restore full data via JSON, or dump attendance to CSV.
- **PWA & Offline** — Installable on mobile and works without internet.

## License

[MIT](LICENSE)
