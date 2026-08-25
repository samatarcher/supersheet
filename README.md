# SuperSheet Prototype

Enterprise-scale sheet application for one logical business process on one million actual database rows.

**Demo Goal:** Prove that a browser can work with 1M records in a single, directly-editable sheet through virtualization, server-side queries, formulas, automation, and real-time collaboration.

**Status:** Planning & Architecture (Phase 0)

---

## Quick Links

- **[Architecture](docs/architecture.md)** — System design, database schema, API contract, data flows
- **[Requirements & Progress](REQUIREMENTS.md)** — Checklist tracking, demo narrative, performance targets
- **[Spec (original)](../Downloads/supersheet_prototype_spec.md)** — Full product specification

---

## Concept

**Use Case:** National Facilities Work Order Register

One sheet with 1,000,000 work orders. Features:

- **Virtualized grid** — Scroll smoothly without loading all rows
- **Server-side search, filter, sort** — Find records across the dataset
- **Editable cells** — Click to edit, optimistic save feedback
- **Formula columns** — Cost Variance, Days Open, Service Level, Risk Level (computed, not copied to every cell)
- **Form submission** — New work orders enter the sheet
- **Automation** — Rules evaluate changes, trigger actions, log activity
- **Reports** — Executive dashboards query the same source (no duplication)
- **Real-time collaboration** — Edits appear in other browsers within 1 second
- **Paid tier** — Demonstrates Enterprise Scale as a premium sheet class

---

## Architecture Overview

```
React Grid (Glide Data Grid)
    ↓
Node.js + Fastify API
    ↓
PostgreSQL (1M rows + indexes)
    ↓
Worker Process (automation + formulas)
```

**Key Design:**
- Row window API: clients request 200-row blocks, never the full dataset
- Row versioning: prevents lost writes on concurrent edits
- Outbox pattern: reliable automation and async processing
- Formula materialization: formulas stored as metadata, computed selectively
- WebSocket broadcasts: real-time multi-user updates
- Demo mode: reset endpoint, switch user, scale inspector for presentation

---

## Development Phases

1. **Phase 1: Scale Spine** (Week 1-2)
   - Database, seed 1M rows, row window API, virtualized grid
   - Gate: Navigate 1M rows without loading them

2. **Phase 2: Query & Edit** (Week 2-3)
   - Search, filter, sort, cell editing, activity log
   - Gate: Find, edit, save, verify

3. **Phase 3: Vertical Slice** (Week 3-4)
   - Formula columns, form, automation, reports
   - Gate: Form → automation → report → activity

4. **Phase 4: Real-Time & Polish** (Week 4-5)
   - WebSocket, capacity panel, comments, record details
   - Gate: Two browsers, real-time edits, paid tier visible

5. **Phase 5: Hardening** (Week 5+)
   - Performance measurements, browser tests, documentation, deployment
   - Gate: Repeatable demo, public ready

---

## Next Steps

1. Confirm tech stack (Node.js + PostgreSQL recommended)
2. Set up local dev environment (Node, PostgreSQL, Docker)
3. Create database migrations
4. Build deterministic seed script (1M rows)
5. Implement row window API endpoint
6. Get Phase 1 gate working (navigate, jump to row 750k)

---

## Tech Stack (Proposed)

| Layer | Technology |
|-------|-----------|
| Frontend | React, TypeScript, Vite, Glide Data Grid |
| Backend | Node.js, Fastify, PostgreSQL |
| Real-time | WebSockets (Fastify.io or ws) |
| Database | PostgreSQL with explicit SQL |
| Worker | Same codebase, separate module (can run in same process) |
| Tests | Playwright (browser), Jest (unit) |
| Deployment | Docker, Railway or Fly.io |

**Rationale:**
- Glide Data Grid is purpose-built for virtualized grids with 1M+ rows
- Node.js for fast iteration and WebSocket support
- PostgreSQL for scale, indexes, and reliability
- React/TypeScript for maintainable frontend code

---

## Files & Structure

```
supersheet/
├── README.md (you are here)
├── REQUIREMENTS.md (checklist & progress tracker)
├── docs/
│   ├── architecture.md (system design)
│   ├── demo_script.md (TODO: exact 12-moment sequence)
│   ├── limitations.md (TODO: what's real vs. simulated)
│   ├── performance_results.md (TODO: measured metrics)
│   └── product_spec.md (TODO: copy of original spec)
├── web/ (TODO: React app)
│   ├── src/
│   └── package.json
├── server/ (TODO: Node.js API)
│   ├── src/
│   └── package.json
├── worker/ (TODO: Background jobs)
│   ├── src/
│   └── package.json
├── shared/ (TODO: Types & validation)
│   ├── src/
│   └── package.json
├── db/ (TODO: Migrations & seed)
│   ├── migrations/
│   ├── seed/
│   └── scripts/
├── Dockerfile (TODO)
├── docker-compose.yml (TODO)
└── .env.example (TODO)
```

---

## How to Use This Repository

**Right now (Planning phase):**
1. Read [architecture.md](docs/architecture.md) for system design
2. Review [REQUIREMENTS.md](REQUIREMENTS.md) for checklist
3. Familiarize yourself with the tech stack choices
4. Confirm you're happy with the direction

**When coding starts:**
1. Update REQUIREMENTS.md as you complete each task
2. Document any deviations from the architecture in docs/
3. Keep performance metrics in docs/performance_results.md
4. Test each phase gate before moving to the next phase

---

## Key Constraints

- **Don't load 1M rows into browser** — Always use virtualization
- **No SQL OFFSET pagination** — Use row_number index for deep navigation
- **No JavaScript eval for formulas** — Parse to AST, whitelist operations only
- **No cell-by-cell record duplication** — Formulas stored as metadata, computed selectively
- **Architect for multi-user from day 1** — WebSocket, session tracking, versioning
- **Demo must reset cleanly** — Seed data reproducible, reset endpoint fast (<30s)

---

## Success Metrics

The prototype succeeds when:
1. Database contains 1,000,000 actual work order rows (verified by query)
2. Browser never holds >5k rows in memory
3. All 12 narrative demo moments work end-to-end
4. Performance targets are met (p95 < defined limits)
5. Multi-user concurrent access works (real-time edits visible)
6. Demo can reset and repeat without manual intervention
7. Can be deployed publicly (Docker, environment-based config)

---

**Questions?** See architecture.md for detailed design decisions, or REQUIREMENTS.md for the full checklist.

**Last Updated:** 2026-08-25
