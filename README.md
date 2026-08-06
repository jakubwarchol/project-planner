# Project Planner

A local, no-backend project planning tool. Fifteen-plus seed projects across four categories, T-shirt sized (S–XXL) on a convex effort scale, scheduled against configurable team-size variants.

## Features

- **Reorderable project list** — drag-and-drop (or arrow buttons) to set rank order per category; order persists in `localStorage`.
- **Category timeline** — months-needed-per-category summary across three team-size variants.
- **Full-screen Gantt timeline** — horizontally scrollable, one row per category, projects queued sequentially through each category's shared team capacity.
- **Advanced mode** — assign a specific headcount to individual projects. Graded projects run concurrently in a priority-based, variable-rate schedule: a project can start understaffed (visibly hatched on the bar) and speed up as higher-priority projects finish and free up capacity. Assignments persist in IndexedDB.

## Stack

React + TypeScript + Vite, no backend — all data is local (seed JSON + browser storage).

## Getting started

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```
