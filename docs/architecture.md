# SuperSheet Prototype Architecture

**Project Goal:** Demonstrate a production-scale sheet for one logical business process on one million actual database rows. Prove that the enterprise problem isn't browser rendering—it's keeping data in one editable object.

**Target Demo:** Shareable, multi-user experience. Single organization, two demo users. Concurrent browsing with real-time edit visibility.

---

## 1. System Overview

```
┌─────────────────────────────────────────────────────────────┐
│                      Web Browser                             │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  React + TypeScript + Glide Data Grid               │   │
│  │  - Virtualized grid (never loads >5k rows in RAM)   │   │
│  │  - Optimistic edits with save feedback              │   │
│  │  - Form submission UI                                │   │
│  │  - Reports & capacity panels                         │   │
│  └──────────────────────────────────────────────────────┘   │
└────────────────────┬────────────────────────────────────────┘
                     │ HTTP + WebSocket
                     │
┌────────────────────▼────────────────────────────────────────┐
│               Node.js + Fastify (API Server)                │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  Row Window API      │  Search & Filter              │   │
│  │  Cell Edit Endpoint  │  Form Submission              │   │
│  │  WebSocket Handler   │  Report Aggregation           │   │
│  │  Formula Evaluation  │  Automation Queries           │   │
│  └──────────────────────────────────────────────────────┘   │
│  Session Management & Connection Pool                        │
└────────────────────┬────────────────────────────────────────┘
                     │ SQL queries
                     │
┌────────────────────▼────────────────────────────────────────┐
│              PostgreSQL (1M work orders)                     │
│  - work_order_rows (base fact table, indexed)               │
│  - sheet_columns (metadata + formula definitions)           │
│  - automation_rules (rule definitions)                      │
│  - outbox_events (work queue for async processing)          │
│  - activity_events (audit trail)                            │
│  - row_comments (discussion)                                │
└──────────────────────────────────────────────────────────────┘
       │
       │ Async worker reads outbox
       │
┌──────▼──────────────────────────────────────────────────────┐
│           Worker Process (same codebase)                     │
│  - Process outbox events                                    │
│  - Evaluate automation rules                                │
│  - Materialize formula columns                              │
│  - Broadcast changes via WebSocket                          │
└──────────────────────────────────────────────────────────────┘
```

---

## 2. Database Schema (Core Tables)

### work_order_rows
Primary fact table. One row per work order. Indexed for deep navigation and filtering.

```sql
CREATE TABLE work_order_rows (
  id UUID PRIMARY KEY,
  sheet_id UUID NOT NULL,
  row_number BIGINT NOT NULL,  -- Stable position in base view
  
  -- Core fields
  work_order_id VARCHAR(20) UNIQUE NOT NULL,  -- Searchable
  title VARCHAR(500) NOT NULL,                 -- Searchable
  facility VARCHAR(100),
  region VARCHAR(100),
  program VARCHAR(100),
  category VARCHAR(100),
  priority VARCHAR(50),      -- Critical, High, Normal, Low
  status VARCHAR(50),        -- New, In Progress, Complete, etc.
  assigned_team VARCHAR(100),
  owner VARCHAR(100),
  
  -- Dates
  submitted_date DATE,
  due_date DATE,
  completed_date DATE,
  
  -- Money
  budget DECIMAL(12,2),
  actual_cost DECIMAL(12,2),
  
  -- Progress
  percent_complete INT,
  notes TEXT,
  
  -- Computed (materialized when needed)
  cost_variance DECIMAL(12,2),       -- [Actual Cost] - [Budget]
  days_open INT,                      -- Today - Submitted
  service_level_status VARCHAR(50),  -- Complete | Overdue | On Track
  risk_level VARCHAR(50),            -- High | Normal
  escalated BOOLEAN DEFAULT FALSE,
  
  -- Concurrency & audit
  row_version INT NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL
);

CREATE INDEX idx_work_order_id ON work_order_rows(work_order_id);
CREATE INDEX idx_sheet_row_number ON work_order_rows(sheet_id, row_number);
CREATE INDEX idx_search ON work_order_rows USING GIN(
  to_tsvector('english', title || ' ' || work_order_id || ' ' || notes)
);
CREATE INDEX idx_filter_status_due ON work_order_rows(sheet_id, status, due_date);
CREATE INDEX idx_filter_priority_status ON work_order_rows(sheet_id, priority, status);
CREATE UNIQUE INDEX idx_unique_wo_per_sheet ON work_order_rows(sheet_id, work_order_id);
```

### sheet_columns
Metadata for each column, including formula definitions.

```sql
CREATE TABLE sheet_columns (
  id UUID PRIMARY KEY,
  sheet_id UUID NOT NULL,
  column_key VARCHAR(100) NOT NULL,  -- title, status, cost_variance, etc.
  name VARCHAR(200),
  data_type VARCHAR(50),  -- text, number, date, checkbox, formula, etc.
  ordinal INT,            -- Display order
  width INT,              -- Render width in pixels
  formula_expression TEXT,  -- "[Actual Cost] - [Budget]" or null
  formula_mode VARCHAR(50), -- virtual | materialized | aggregate
  is_indexed BOOLEAN DEFAULT FALSE,
  is_visible BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL
);
```

### automation_rules
Trigger → Condition → Actions.

```sql
CREATE TABLE automation_rules (
  id UUID PRIMARY KEY,
  sheet_id UUID NOT NULL,
  name VARCHAR(200),
  enabled BOOLEAN DEFAULT TRUE,
  
  trigger_definition JSONB,  -- {event: "row_created", fields: ["priority", "status"]}
  condition_definition JSONB, -- {operator: "and", conditions: [{field: "priority", op: "=", value: "Critical"}]}
  action_definition JSONB,   -- [{action: "set_field", field: "escalated", value: true}, ...]
  
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL
);
```

### outbox_events
Work queue. Ensures reliable processing of changes.

```sql
CREATE TABLE outbox_events (
  id UUID PRIMARY KEY,
  sheet_id UUID NOT NULL,
  row_id UUID NOT NULL,
  event_type VARCHAR(50),   -- row_created | cell_updated | row_updated
  changed_fields_json JSONB, -- Which fields changed
  payload_json JSONB,
  status VARCHAR(50) DEFAULT 'pending',  -- pending | processing | completed
  attempt_count INT DEFAULT 0,
  created_at TIMESTAMP NOT NULL,
  processed_at TIMESTAMP
);

CREATE INDEX idx_outbox_pending ON outbox_events(status, created_at)
  WHERE status IN ('pending', 'processing');
```

### activity_events
Immutable audit log.

```sql
CREATE TABLE activity_events (
  id UUID PRIMARY KEY,
  sheet_id UUID NOT NULL,
  row_id UUID NOT NULL,
  actor_id UUID,
  source_type VARCHAR(50), -- user_edit | automation | form_submission
  action_type VARCHAR(50),  -- field_changed | comment_added | rule_triggered
  changes_json JSONB,       -- What changed
  created_at TIMESTAMP NOT NULL
);

CREATE INDEX idx_row_activity ON activity_events(sheet_id, row_id, created_at);
```

### row_comments
Simple threaded comments.

```sql
CREATE TABLE row_comments (
  id UUID PRIMARY KEY,
  sheet_id UUID NOT NULL,
  row_id UUID NOT NULL,
  author_id UUID NOT NULL,
  body TEXT,
  created_at TIMESTAMP NOT NULL
);
```

### sessions
Track active browsers for real-time updates.

```sql
CREATE TABLE sessions (
  id VARCHAR(100) PRIMARY KEY,
  sheet_id UUID NOT NULL,
  user_id UUID,
  display_name VARCHAR(200),
  created_at TIMESTAMP NOT NULL,
  last_seen_at TIMESTAMP NOT NULL
);
```

---

## 3. API Contract

### Row Window (Core Pagination)

```
GET /api/views/:view_id/window?start=0&limit=200

Response:
{
  "view_id": "...",
  "start": 0,
  "limit": 200,
  "total_count": 1000000,
  "rows": [
    {
      "id": "uuid",
      "row_number": 1,
      "work_order_id": "WO-001",
      "title": "...",
      "status": "...",
      ... all columns
    }
  ],
  "query_duration_ms": 45,
  "cached": false
}
```

Uses row_number for stable offset. No SQL OFFSET for deep pagination.

### Cell Edit

```
PATCH /api/sheets/:sheet_id/rows/:row_id/cells/:column_key

Request:
{
  "value": "Critical",
  "expected_version": 5
}

Response:
{
  "success": true,
  "row_version": 6,
  "updated_at": "2026-08-25T12:34:56Z"
}

OR on conflict:
{
  "success": false,
  "conflict": true,
  "current_row": { ... full row },
  "current_version": 7
}
```

Row versioning prevents lost writes.

### Search

```
POST /api/sheets/:sheet_id/search

Request:
{
  "query": "WO-12345",
  "limit": 10
}

Response:
{
  "results": [
    {
      "row_id": "...",
      "row_number": 750123,
      "work_order_id": "WO-12345",
      "title": "...",
      "snippet": "..."
    }
  ],
  "total_count": 3
}
```

Server-side text search using PostgreSQL GIN index.

### Filter & Sort

```
POST /api/views/:view_id/apply_filters

Request:
{
  "filters": [
    { "field": "status", "operator": "is_any_of", "values": ["Critical", "High"] },
    { "field": "due_date", "operator": "is_before", "value": "2026-08-25" }
  ],
  "sort": [
    { "field": "priority", "direction": "desc" },
    { "field": "due_date", "direction": "asc" }
  ],
  "limit": 200
}

Response:
{
  "result_count": 12345,
  "rows": [...]
}
```

All construction uses whitelist + parameterized queries. No SQL injection.

### Form Submission

```
POST /api/forms/:form_id/submit

Request:
{
  "title": "New equipment repair",
  "facility": "Building A",
  "region": "Northeast",
  "category": "Maintenance",
  "priority": "Normal",
  "due_date": "2026-09-15",
  "budget": "5000",
  "description": "..."
}

Response:
{
  "row_id": "uuid",
  "work_order_id": "WO-1000234",
  "row_number": 1000234
}
```

Triggers formula evaluation + outbox event for automation.

### Automation Log

```
GET /api/sheets/:sheet_id/automation_executions?limit=50

Response:
{
  "executions": [
    {
      "id": "uuid",
      "rule_name": "Escalate Critical Work Orders",
      "row_id": "...",
      "triggered_at": "2026-08-25T12:34:56Z",
      "status": "completed",
      "actions_taken": [
        { "action": "set_field", "field": "escalated", "value": true },
        { "action": "set_field", "field": "assigned_team", "value": "Emergency Response" }
      ],
      "duration_ms": 234
    }
  ]
}
```

---

## 4. Frontend Data Flow

### Grid State Machine

1. **Idle** — User scrolls naturally
2. **Fetching** — Request row window for visible range
3. **Cached** — Return from in-memory cache if available
4. **Rendering** — Glide Data Grid renders cells
5. **Editing** — User types in cell
6. **Optimistic** — Update displayed value immediately, show spinner
7. **Saving** — Send PATCH to API with expected row version
8. **Success** — Remove spinner, persist display
9. **Conflict** — Show modal: "This row changed. Keep mine / Use latest?"

Cache strategy:
- In-memory LRU cache of ~10-20 windows (200 rows each = ~2-4k rows max in RAM)
- Invalidate specific windows after edits (not the whole cache)
- Abort stale requests if user scrolls during fetch

### Column Metadata Sync

On startup:
```
GET /api/sheets/:sheet_id/columns → cache locally
```

Columns include:
- `name`, `data_type`, `formula_expression`, `is_indexed`
- Used to know which columns are editable, which are read-only formulas, which need special renderers

### Form Submission Flow

1. User opens form modal
2. Fill required fields (title, facility, etc.)
3. Click submit
4. POST to `/api/forms/:form_id/submit`
5. Response includes `row_number`
6. Jump to that row in grid
7. Listen for outbox broadcast: row now has formula values + automation complete

---

## 5. Real-Time (WebSockets)

### Connection

When a browser loads the sheet, it opens a WebSocket to the API:

```
WS wss://api.example.com/ws?sheet_id=xxx&session_id=yyy&user_name=Alice
```

Server tracks the session in `sessions` table.

### Broadcasts

When an event happens (edit, form submission, automation), the worker broadcasts:

```json
{
  "type": "cell_updated",
  "row_id": "uuid",
  "row_number": 12345,
  "column_key": "status",
  "value": "In Progress",
  "actor": "Bob",
  "row_version": 8
}
```

Connected browsers receive this and:
1. If the row is visible, update the cell
2. If it's a remote user (not the editor), highlight briefly
3. Increment row version for future edits

Other broadcast types:
- `row_created` — New row inserted (show in grid if filtered in)
- `row_deleted` — Row removed
- `automation_completed` — Rule fired, show activity in details panel
- `session_joined` / `session_left` — Who's viewing

---

## 6. Worker / Automation

### Outbox Processing Loop

Every 100ms (or when batch reaches 50 events):

1. Read pending outbox events from `outbox_events` (status='pending')
2. For each event:
   - Load the row
   - Find enabled automation rules that match the trigger
   - Evaluate conditions against the row
   - Execute actions (set fields, create activity)
   - Write results to `activity_events`
   - Mark outbox event as completed
3. Broadcast changes via WebSocket

### Formula Materialization

When a formula column is added (e.g., Cost Variance):
- Set `formula_mode = 'materialized'`
- Worker computes the formula for all 1M rows in batches
- Stores results in `cost_variance` column
- Updates a status field so UI knows when computation is done
- Any subsequent edit re-evaluates just that row

### Example: Escalation Rule

Trigger: `row_created` OR field changed = `priority` OR field changed = `status`

Condition: `priority = 'Critical' AND status != 'Complete'`

Actions:
1. Set `escalated = true`
2. Set `assigned_team = 'Emergency Response'`
3. Create activity event: "Escalation rule applied"
4. Create in-app notification

---

## 7. Scale Guarantees

### What We Track (Scale Inspector)

The `/api/demo/scale_inspector` endpoint returns:

```json
{
  "database_row_count": 1000000,
  "populated_field_estimate": 8500000,
  "current_client_window": { "start": 750000, "size": 200 },
  "browser_cached_rows": 4200,
  "last_query_duration_ms": 45,
  "last_query_cached": false,
  "last_edit_persist_ms": 234,
  "last_automation_ms": 312,
  "websocket_status": "connected"
}
```

This proves:
- The million rows are real (not generated in JS)
- Only a small window is in the browser
- Queries are fast and cached where applicable

### Performance Targets

- First sheet load: shell appears in <500ms, first rows in <3s
- Cached row window: <250ms (p95)
- Uncached indexed query: <800ms (p95)
- Search (indexed text): <2s
- Cell edit → persisted: <500ms
- Remote edit broadcast: <1s
- Form submission → visible in grid: <2s
- Automation → complete: <3s

---

## 8. Deployment Model

### Local Dev
- Node.js server on localhost:3000
- PostgreSQL on localhost:5432 (or Docker container)
- 1M rows (or configurable SEED_ROW_COUNT for faster iteration)
- React dev server on localhost:5173 (Vite)

### Public Demo
- Docker image with Dockerfile
- PostgreSQL managed (Render.com, Fly.io, etc.)
- Node.js server deployed (Railway, Fly.io, etc.)
- Static React build served by Node
- Environment variables for DB_URL, API_KEY, DEMO_MODE, SEED_ROW_COUNT, pricing tiers

---

## 9. Implementation Approach

### Phase 1: Scale Spine
- [ ] PostgreSQL schema + 1M seed
- [ ] `GET /views/:view_id/window` API
- [ ] React + Glide Data Grid grid
- [ ] Scale Inspector
- [ ] Deep navigation (row 750k jump)

**Gate:** "Open sheet, scroll to row 750k, show exact DB count"

### Phase 2: Query & Edit
- [ ] Search API + UI
- [ ] Filter & sort (server-side)
- [ ] Cell edit PATCH + row versioning
- [ ] Optimistic feedback
- [ ] Activity log (basic)

**Gate:** "Find, edit, save, see in DB"

### Phase 3: Vertical Slice
- [ ] Formula columns (4 required)
- [ ] Form submission
- [ ] Outbox worker
- [ ] Escalation automation
- [ ] Executive report

**Gate:** "Form → automation → report → activity"

### Phase 4: Real-Time & Polish
- [ ] WebSocket broadcasts
- [ ] Two demo users
- [ ] Capacity panel
- [ ] Comments
- [ ] Record details panel

**Gate:** "Two browsers, see edits in real-time, paid tier shows"

### Phase 5: Hardening
- [ ] Demo reset endpoint
- [ ] Known demo records (seeded)
- [ ] Performance measurements
- [ ] Browser tests
- [ ] Documentation

**Gate:** "Full narrative works, repeatable, public demo ready"

---

## 10. Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| No SQL OFFSET pagination | OFFSET is O(n) at deep rows. Use row_number index instead. |
| Row versioning on every edit | Optimistic UI + conflict detection. Prevents lost writes. |
| Outbox pattern for automation | Ensures reliability. Changes → outbox event → worker. If worker crashes, event retries. |
| Materialized formula columns | Formulas stored once as metadata, computed selectively (virtual for display, materialized for sort/filter/report). |
| In-memory session + LRU cache | Sufficient for demo. Upgrade to Redis later if needed without rearchitecting. |
| Whitelist + parameterized queries | No string interpolation. Every filter/sort uses a whitelist. |
| WebSocket pub/sub per sheet | Not a global room. Each sheet has its own broadcast topic. Scales linearly. |
| Demo mode flag | When enabled, `/api/demo/reset` and `/api/demo/switch_user` work. Disabled in production. |

---

## 11. Transition Paths

If we later need to scale beyond the demo:

- **Session store** → Replace in-memory with Redis
- **Row cache** → Replace LRU with distributed cache (Redis)
- **WebSocket** → Replace in-process pub/sub with Redis Pub/Sub or AWS SNS
- **Worker** → Scale to multiple workers with distributed job queue (Bull, RabbitMQ, AWS SQS)
- **Database** → Add read replicas, connection pooling (PgBouncer)

The architecture doesn't preclude these; they're upgrades, not rewrites.

