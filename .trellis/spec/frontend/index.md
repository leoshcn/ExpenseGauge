# Frontend Development Guidelines

> Conventions of the ExpenseGauge frontend (`frontend/`), written from the code as it is.

---

## Overview

A single-page app for one signed-in user. It talks only to the REST API under `/api/v1`,
on its own origin (Vite proxy in development, nginx in production), with an HttpOnly
session cookie.

Stack: React 19 + TypeScript 5.9 + Vite 8, React Router 7 (declarative `<Routes>`),
TanStack Query 5, `openapi-typescript` + `openapi-fetch` for the typed client, Tailwind
CSS 4, shadcn/ui components vendored into `src/components/ui`, Recharts 3 through the
shadcn/ui chart wrapper, vitest + Testing Library, eslint. Package manager: **npm**.

Pages: setup, login, onboarding, Dashboard, transactions, budgets, settings (accounts,
categories, agent tokens and connection details).

The UI is Simplified Chinese only. Visual decisions are recorded in `frontend/DESIGN.md`.

---

## Guidelines Index

| Guide | Description | Status |
|-------|-------------|--------|
| [Directory Structure](./directory-structure.md) | Where code goes, naming | Filled |
| [Component Guidelines](./component-guidelines.md) | Components, styling with tokens, copy, accessibility | Filled |
| [Hook Guidelines](./hook-guidelines.md) | Custom hooks, data fetching with query options | Filled |
| [State Management](./state-management.md) | Server state, URL state, local state, the route guard | Filled |
| [Quality Guidelines](./quality-guidelines.md) | Checks, tests, forbidden patterns, review checklist | Filled |
| [Type Safety](./type-safety.md) | Generated API types, `ApiError`, money and month strings | Filled |

---

## Pre-Development Checklist

Before changing the frontend, read:

1. [Directory Structure](./directory-structure.md) - always.
2. [Type Safety](./type-safety.md) and [Hook Guidelines](./hook-guidelines.md) - when a
   page reads from or writes to the API.
3. [Component Guidelines](./component-guidelines.md) and `frontend/DESIGN.md` - when
   anything visible changes.
4. [State Management](./state-management.md) - when adding state that outlives a component.
5. [Quality Guidelines](./quality-guidelines.md) - before running the checks and before review.
6. `../backend/error-handling.md` - the error envelope and reason codes the client surfaces.
7. `../guides/cross-layer-thinking-guide.md` - when a response shape changes.

---

**Language**: All documentation should be written in **English**.
