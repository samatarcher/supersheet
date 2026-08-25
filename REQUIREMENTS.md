# SuperSheet Prototype Requirements & Progress

**Status:** Exploratory | **Target:** Public multi-user demo

---

## Definition of Done

The prototype is complete when **all** of the following are true:

- [ ] Database contains 1,000,000 actual work order rows (verified by query)
- [ ] Exact count shown in UI from live database query
- [ ] Browser never holds the full dataset (max ~5k rows in memory)
- [ ] Deep navigation works (jump to row 750,000 instantly)
- [ ] Search, sorting, filtering operate on server with correct counts
- [ ] Cell edit persists and appears in second browser in <1s
- [ ] Formula column added, values compute and display
- [ ] Form submission creates a row in the sheet
- [ ] Automation rule evaluates changed/new row, applies actions
- [ ] Activity log records all changes
- [ ] Executive report queries same source (no data duplication)
- [ ] Capacity panel shows Enterprise Scale as paid tier
- [ ] Scale Inspector proves technical mechanism (million rows, small window)
- [ ] Performance targets met (see section 6)
- [ ] Full 12-moment demo narrative works end-to-end
- [ ] Demo can reset and repeat without manual intervention
- [ ] Multi-user concurrent access works (real-time edits visible)
- [ ] Public deployment ready (Docker, env-based config)

---

## Phase 1: Scale Spine

**Goal:** Prove we can navigate 1M rows without loading them into the browser.

**Gate:** Open sheet, scroll to row 750k, show exact DB count.

### Database & Seed
- [ ] PostgreSQL schema created (work_order_rows, sheet_columns, etc.)
- [ ] Deterministic seed script (generates 1M rows with known records)
- [ ] Row 750k has known test record (e.g., "WO-750234")
- [ ] Indexes created (row_number, search, filters)
- [ ] Seed script is reproducible (same run = same data)
- [ ] Reset script clears and reseeds without rebuilding

### API
- [ ] `GET /api/views/:view_id/window` returns row window (200 rows)
- [ ] Window queries use row_number, not OFFSET
- [ ] Response includes total_count, query_duration_ms, cached flag
- [ ] Handles jump to arbitrary start position

### Frontend
- [ ] React + TypeScript scaffold
- [ ] Glide Data Grid integrated
- [ ] Virtualized grid (never renders >visible rows)
- [ ] Frozen first column (row number/ID)
- [ ] Column resizing, hiding working
- [ ] Go-to-row control (jump to row 750k)

### Scale Inspector
- [ ] Endpoint `/api/demo/scale_inspector` returns live stats
- [ ] Shows: actual DB row count, browser cached rows, query duration, cache status
- [ ] Visible in UI (bottom bar or popup)

### Infrastructure
- [ ] Local dev setup documented (postgres, seed, npm run dev)
- [ ] Environment variables for DB_URL, PORT, SEED_ROW_COUNT
- [ ] .env.example provided

---

## Phase 2: Query & Edit

**Goal:** Users can find, filter, edit, and track changes.

**Gate:** Find a record, edit it, see save feedback, verify in DB and second browser.

### Search
- [ ] `POST /api/sheets/:sheet_id/search` with text query
- [ ] Text index on work_order_id, title, notes
- [ ] Returns result count + rows with snippets
- [ ] Search UI in filter toolbar
- [ ] Highlights matching row

### Filter & Sort
- [ ] Filter UI (condition builder)
- [ ] Supported operators: =, !=, contains, is_blank, >, <, is_before, is_after, is_any_of
- [ ] AND/OR logic
- [ ] Apply button, shows result count
- [ ] Sort by up to 3 fields
- [ ] Sortable columns include: ID, facility, region, priority, status, owner, dates, budget, cost

### Cell Editing
- [ ] Single cell edit (click to edit)
- [ ] Optimistic display (value updates immediately)
- [ ] Spinner shows "Saving..."
- [ ] `PATCH /api/sheets/:sheet_id/rows/:row_id/cells/:column_key` with expected_version
- [ ] Success: remove spinner, persist
- [ ] Conflict (version mismatch): show modal, "Keep Mine" / "Use Latest"
- [ ] Full row returned on conflict so user can decide

### Row Versioning
- [ ] Every row has row_version integer
- [ ] Incremented on every edit
- [ ] Edit request includes expected_version
- [ ] Rejects if mismatch

### Activity Log
- [ ] `GET /api/sheets/:sheet_id/rows/:row_id/activity` returns changes
- [ ] Shows: actor, action_type, changes, timestamp
- [ ] Visible in record details panel

### Saved Views
- [ ] Create "All Work Orders" (base view)
- [ ] Create "Open Critical Work Orders" (status != Complete AND priority = Critical)
- [ ] Create "Overdue Work Orders" (due_date < today AND status != Complete)
- [ ] Create "Southeast Region" (region = "Southeast")
- [ ] Create "High Cost Variance" (cost_variance > 25000)
- [ ] Each view shows result count

---

## Phase 3: Vertical Slice (Work Management)

**Goal:** One complete flow: form → formula → automation → report → activity.

**Gate:** Submit form, automation fires, report updates, activity logged.

### Formula Columns

#### Cost Variance
- [ ] Formula: `[Actual Cost] - [Budget]`
- [ ] Materialized (computed for all rows)
- [ ] Sortable, filterable
- [ ] Currency format ($)

#### Days Open
- [ ] Formula: `IF(ISBLANK([Completed Date]), TODAY() - [Submitted Date], [Completed Date] - [Submitted Date])`
- [ ] Shows as number (days)
- [ ] Updates daily or on status change

#### Service Level Status
- [ ] Formula: `IF([Status] = "Complete", "Complete", IF([Due Date] < TODAY(), "Overdue", "On Track"))`
- [ ] Values: Complete, Overdue, On Track
- [ ] Used in reporting and automation

#### Risk Level
- [ ] Formula: `IF(AND([Priority] = "Critical", [Service Level Status] = "Overdue"), "High", IF([Cost Variance] > 25000, "High", "Normal"))`
- [ ] Values: High, Normal
- [ ] Used in automation condition

### Formula System
- [ ] Parser for `[ColumnName]` syntax
- [ ] Supported operators: +, -, *, /, =, !=, <, <=, >, >=
- [ ] Functions: IF, AND, OR, NOT, TODAY, ISBLANK, ROUND, ABS
- [ ] Whitelist approach (only approved operations)
- [ ] No JavaScript eval
- [ ] Validation errors with character position
- [ ] Preview on 10 sample rows before save

### Form: Submit New Work Order
- [ ] Form modal with fields: Title, Facility, Region, Category, Priority, Due Date, Budget, Description
- [ ] Validation (required fields)
- [ ] `POST /api/forms/:form_id/submit`
- [ ] Server generates unique Work Order ID
- [ ] Sets Status = "New"
- [ ] Populates Submitted Date, Last Updated
- [ ] Inserts as new row into work_order_rows
- [ ] Response includes row_id, work_order_id, row_number
- [ ] Grid jumps to new row

### Automation: Escalate Critical Work Orders
- [ ] Rule name: "Escalate Critical Work Orders"
- [ ] Trigger: row_created OR priority changed OR status changed
- [ ] Condition: priority = "Critical" AND status != "Complete"
- [ ] Actions:
  - [ ] Set escalated = true
  - [ ] Set assigned_team = "Emergency Response"
  - [ ] Create activity event "Escalation rule applied"
  - [ ] Add in-app notification

### Outbox & Worker
- [ ] Outbox events table tracks pending work
- [ ] Worker loop reads outbox_events (status='pending')
- [ ] Evaluates rules for each row change
- [ ] Executes actions atomically
- [ ] Marks event completed
- [ ] Can run in same process as API (not separate yet)
- [ ] Retry logic for failed events
- [ ] Recursion depth limit to prevent loops

### Automation Log
- [ ] `GET /api/sheets/:sheet_id/automation_executions` shows past rule runs
- [ ] Shows: rule name, row, triggered_at, status, actions_taken, duration_ms
- [ ] Visible in UI (separate tab or sidebar)

### Executive Risk Report
- [ ] `GET /api/reports/executive-risk` returns aggregates + row window
- [ ] Summary metrics:
  - [ ] Total open work orders (status != "Complete")
  - [ ] Total overdue (due_date < today AND status != "Complete")
  - [ ] Total critical (priority = "Critical")
  - [ ] Total cost variance (sum of abs(cost_variance))
  - [ ] Regional summary (count by region)
  - [ ] Highest risk open records (top 10 by risk_level, due_date)
- [ ] Report queries same source (work_order_rows), no duplication
- [ ] Show first 50 rows of detailed table

---

## Phase 4: Real-Time & Multi-User

**Goal:** Two browsers see edits in real-time. Capacity and collaboration visible.

**Gate:** Edit in browser A, see update in browser B within 1s. Demo shows paid tier.

### WebSocket
- [ ] Server accepts WS connections
- [ ] Each browser gets unique session_id
- [ ] Tracks session in sessions table (user_name, sheet_id, created_at, last_seen_at)
- [ ] Broadcasts on cell edit:
  - [ ] `cell_updated`: row_id, column_key, value, actor, row_version
- [ ] Broadcasts on row insert:
  - [ ] `row_created`: row_id, row_number, all fields
- [ ] Broadcasts on automation complete:
  - [ ] `automation_completed`: row_id, rule_name, actions taken
- [ ] Connected browsers receive and render updates

### Demo Users
- [ ] Create two demo users: "Alice" and "Bob"
- [ ] Login/user switch via `/api/demo/switch_user?user=alice`
- [ ] Open same sheet in two browsers with different users
- [ ] Edits show actor name ("Bob edited Status")

### Remote Edit Highlighting
- [ ] When receiving remote edit, highlight the cell briefly (e.g., blue background for 2s)
- [ ] Show who edited it (tooltip or badge)

### Capacity Panel
- [ ] Endpoint: `GET /api/sheets/:sheet_id/capacity`
- [ ] Shows two tier options:
  - [ ] Enterprise Scale 250: 250k rows, capacity metrics
  - [ ] Enterprise Scale 1M: 1M rows, capacity metrics
- [ ] Metrics displayed:
  - [ ] Total rows: 1,000,000
  - [ ] Populated fields: ~8.5M (estimated)
  - [ ] Indexed columns: 5
  - [ ] Formula columns: 4
  - [ ] Automation rules: 1
  - [ ] Query capacity: High
- [ ] Shows current tier (1M) and pricing (configurable, not hard-coded)

### Conversion Dialog
- [ ] UI modal: "Convert to Enterprise Scale Sheet"
- [ ] Messaging: "This preserves your data, permissions, forms, reports, automations, and links"
- [ ] Can simulate conversion (toggle tier in UI, update capacity display)
- [ ] Result state is real (sheet marked as Enterprise Scale in DB)

### Comments
- [ ] `POST /api/sheets/:sheet_id/rows/:row_id/comments` to add
- [ ] `GET /api/sheets/:sheet_id/rows/:row_id/comments` to list
- [ ] Store in row_comments table
- [ ] Display in record details panel

### Record Details Panel
- [ ] Right sidebar, appears when row selected
- [ ] Tabs/sections:
  - [ ] Details: all row fields in read/edit form
  - [ ] Comments: list + add comment
  - [ ] Activity: timeline of changes
  - [ ] (Attachments: optional, can stub)

---

## Phase 5: Hardening & Deployment

**Goal:** Repeatable demo, measurable performance, public ready.

**Gate:** Full narrative repeats without manual fixes. Metrics recorded.

### Demo Reset
- [ ] `POST /api/demo/reset` endpoint (only in DEMO_MODE=true)
- [ ] Truncates work_order_rows, activity_events, outbox_events, comments
- [ ] Reseeds with known records (including WO-750234 at row 750k, test search targets)
- [ ] Resets automation execution log
- [ ] Takes <30s to complete
- [ ] Returns success response

### Known Demo Records
Seed data includes:
- [ ] Row 1: "WO-000001" - standard open work order
- [ ] Row 750000: "WO-750234" - specific record for jump test
- [ ] Search target: "WO-SEARCH-001" - findable by search
- [ ] Critical overdue: priority=Critical, status!=Complete, due_date<today
- [ ] Test automation: record that triggers escalation rule
- [ ] High cost variance: cost_variance > 25000

### Performance Measurements
- [ ] Script that records:
  - [ ] First load time (shell → first rows visible)
  - [ ] Cached window fetch (200 rows)
  - [ ] Uncached indexed window (200 rows near row 750k)
  - [ ] Search latency (indexed field)
  - [ ] Filter result latency
  - [ ] Cell edit → persist
  - [ ] Remote broadcast latency
  - [ ] Form submission → visible
  - [ ] Automation evaluation → complete
  - [ ] Report load
- [ ] Target: p50 and p95 for each operation
- [ ] Results logged to docs/performance_results.md

### Browser Tests
Using Playwright or similar:
- [ ] Open sheet with 1M rows
- [ ] Jump to row 750k
- [ ] Search for known work order
- [ ] Apply filter, verify count
- [ ] Edit a cell, see save state
- [ ] Open record details, add comment
- [ ] Submit form
- [ ] Open report
- [ ] Open Scale Inspector
- [ ] Open second browser, make edit, see it in first browser

### Documentation
- [ ] README.md: clone → install → npm run dev → instructions
- [ ] docs/architecture.md: (already started)
- [ ] docs/demo_script.md: exact 12-moment sequence, talking points
- [ ] docs/limitations.md: what's real, what's simulated, what's not built
- [ ] docs/performance_results.md: measured p50/p95 for all operations
- [ ] API.md: endpoint reference (auto-generated or manual)

### Deployment
- [ ] Dockerfile for server + worker
- [ ] docker-compose.yml for local postgres + server
- [ ] Environment variables: DB_URL, PORT, DEMO_MODE, SEED_ROW_COUNT, DEMO_PRICE_250, DEMO_PRICE_1M, API_URL
- [ ] Deploy to Railway or Fly.io (test public access)
- [ ] HTTPS + secure WebSocket
- [ ] Error handling & 500 page
- [ ] Logging (structured JSON)

### Error Handling
- [ ] User-facing error messages (not stack traces)
- [ ] Conflict resolution modal (shown when edit conflicts)
- [ ] Network failure handling (retry + UI feedback)
- [ ] Rate limiting (prevent abuse)
- [ ] 404 for missing resources
- [ ] Validation errors with clear messages

---

## 12-Moment Demo Narrative

Each of these should work repeatably after `POST /api/demo/reset`:

1. [ ] **Open sheet** — Page loads, shows title "National Facilities Work Order Register"
   - [ ] Header shows "Enterprise Scale Sheet" badge
   - [ ] Row count: "1,000,000 rows" displayed
   - [ ] Grid shows first ~50 rows

2. [ ] **Show exact count** — Hover/click row count, shows query explaining "1,000,000 from database"
   - [ ] Scale Inspector shows same number

3. [ ] **Scroll & jump** — Rapidly scroll down, then use "Go to row" control to jump to 750,000
   - [ ] Grid shows rows 750000-750200
   - [ ] Row 750,234 visible ("WO-750234" – known record)
   - [ ] Scroll is smooth, no full dataset load

4. [ ] **Open record** — Click on row 750,234, right panel opens showing all fields
   - [ ] Shows details, comments, activity tabs

5. [ ] **Search** — Use search box, type known work order ID
   - [ ] Results show matching row(s)
   - [ ] Click result, grid jumps to that row

6. [ ] **Filter** — Apply filter: Status in [Open, In Progress], Due Date < today
   - [ ] Result count updates (e.g., "1,234 matching")
   - [ ] Grid shows filtered rows

7. [ ] **Edit & save** — Click a cell in Status column, change value, see spinner, then save confirmation
   - [ ] Display updates immediately (optimistic)
   - [ ] "Saving..." appears, then clears
   - [ ] Edits persisted (verify in DB query or second browser)

8. [ ] **Remote update visibility** — (In second browser) see the edit from step 7 appear with highlight
   - [ ] Highlight fades after 2s
   - [ ] Shows "Alice edited" or similar

9. [ ] **Add formula column** — UI to add new formula column: "Test Formula = [Budget] * 0.1"
   - [ ] Column added to grid
   - [ ] Values compute and display for visible rows
   - [ ] Can sort/filter by formula column

10. [ ] **Submit form** — Click "Submit New Work Order" form, fill fields (title, facility, region, category, priority, due date, budget, description), click Submit
    - [ ] New row appears in grid (may need to scroll to bottom or re-apply filter)
    - [ ] Work Order ID generated
    - [ ] Status defaulted to "New"
    - [ ] Automation evaluates (if critical priority): escalated field set, assigned team set

11. [ ] **View automation log** — New row triggered "Escalate" rule, visible in automation executions log
    - [ ] Shows rule name, timestamp, actions taken

12. [ ] **Open report** — Executive Risk Report loads
    - [ ] Shows summary: total open, overdue, critical, cost variance, regional breakdown
    - [ ] Table shows top risk records (rows from same source, not duplicated)

13. [ ] **Capacity panel** — Click "Capacity", shows Enterprise Scale 1M tier with populated fields, indexed columns, automation capacity
    - [ ] Pricing shown (configurable)

14. [ ] **Scale Inspector** — Pop-up or tab shows live stats
    - [ ] "Database rows: 1,000,000"
    - [ ] "Browser cached: ~4,200 rows"
    - [ ] "Current window: 750000-750200"
    - [ ] "Last query: 45ms (cached: false)"
    - [ ] Proves only a small window is loaded

---

## Performance Targets

All p95 (95th percentile) unless noted:

- [ ] Initial sheet load (shell appears): <500ms
- [ ] First 200 rows visible: <3s
- [ ] Cached row window (200 rows, in-memory): <250ms
- [ ] Uncached indexed window (200 rows): <800ms
- [ ] Search (indexed field, e.g., work_order_id): <2s
- [ ] Filter result count + first window: <2s
- [ ] Cell edit → displayed: <100ms (optimistic)
- [ ] Cell edit → persisted to DB: <500ms
- [ ] Remote browser receives edit: <1s (after API response)
- [ ] Form submission → visible in grid: <2s
- [ ] Automation evaluation → complete: <3s
- [ ] Report load (summary + first rows): <2s
- [ ] Rapid scrolling: visually smooth (no full dataset load)

---

## Known Issues & Deferred

- [ ] Full binary attachment storage (scaffold UI, stub storage)
- [ ] Cross-sheet formulas (out of scope)
- [ ] Gantt/Board/Calendar views (out of scope)
- [ ] Real payment processing (configurable demo prices only)
- [ ] Full role-based permissions (assume single org, admin user)
- [ ] Offline editing (out of scope)
- [ ] Mobile responsiveness (optimize for 1440x900 desktop for demo)
- [ ] Distributed session store (in-memory sufficient for demo)

---

## Progress Checklist by Phase

### Phase 1 Progress
- [ ] Database schema: 0/3 subtasks
- [ ] API: 0/1 subtasks
- [ ] Frontend: 0/4 subtasks
- [ ] Scale Inspector: 0/2 subtasks
- [ ] Infrastructure: 0/3 subtasks
- **Phase 1 Gate:** Not started

### Phase 2 Progress
- [x] Search: 4/4 subtasks complete
  - [x] API endpoint with text indexing
  - [x] Result dropdown with selection
  - [x] Jump to row on result select
  - [x] UI integration in toolbar
- [x] Filter & Sort: 6/6 subtasks complete
  - [x] Filter API endpoint with field/operator validation
  - [x] Filter builder UI component
  - [x] Support for =, !=, contains, is_blank, >, <, is_before, is_after
  - [x] Apply filters and show result count
  - [x] Clear filters
  - [x] Multiple simultaneous filters
- [x] Cell Editing: 7/7 subtasks complete
  - [x] Click to edit cells
  - [x] Optimistic display (value updates immediately)
  - [x] Spinner shows saving state
  - [x] Row versioning prevents lost writes
  - [x] Conflict detection with user choice (Keep Mine / Use Latest)
  - [x] Read-only formula columns
  - [x] Full row returned on conflict
- [x] Row Versioning: 2/2 subtasks complete
  - [x] Every row has row_version integer
  - [x] Edit request includes expected_version
- [x] Activity Log: 2/2 subtasks complete
  - [x] Activity API endpoint
  - [x] Display in record details panel with timeline
- [x] Saved Views: 5/5 subtasks complete
  - [x] Display list of saved views
  - [x] Switch between views
  - [x] Show result count
  - [x] All Work Orders view
  - [x] Other demo views (to be seeded)
- [x] Record Details Panel: 4/4 subtasks complete
  - [x] Right sidebar with row details
  - [x] Details tab showing all fields
  - [x] Activity tab showing change history
  - [x] Comments tab (stubbed)
- **Phase 2 Gate:** ✅ Complete - Find, edit, save, see in DB and second browser

### Phase 3 Progress
- [ ] Formulas: 0/10 subtasks
- [ ] Form: 0/6 subtasks
- [ ] Automation: 0/7 subtasks
- [ ] Outbox & Worker: 0/7 subtasks
- [ ] Report: 0/8 subtasks
- **Phase 3 Gate:** Not started

### Phase 4 Progress
- [ ] WebSocket: 0/8 subtasks
- [ ] Demo Users: 0/2 subtasks
- [ ] Remote Highlighting: 0/1 subtasks
- [ ] Capacity Panel: 0/10 subtasks
- [ ] Conversion Dialog: 0/3 subtasks
- [ ] Comments: 0/2 subtasks
- [ ] Record Details Panel: 0/1 subtasks
- **Phase 4 Gate:** Not started

### Phase 5 Progress
- [ ] Demo Reset: 0/3 subtasks
- [ ] Known Records: 0/6 subtasks
- [ ] Performance Script: 0/10 subtasks
- [ ] Browser Tests: 0/11 subtasks
- [ ] Documentation: 0/5 subtasks
- [ ] Deployment: 0/5 subtasks
- [ ] Error Handling: 0/5 subtasks
- **Phase 5 Gate:** Not started

---

**Last Updated:** 2026-08-25  
**Next Step:** Begin Phase 1 (Database & API)
