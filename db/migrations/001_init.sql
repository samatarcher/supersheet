-- SuperSheet Prototype: Initial Schema
-- Creates the foundation for 1M-row work order management system

-- Organizations (multi-tenant structure, even though demo is single org)
CREATE TABLE organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Users
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  display_name VARCHAR(255) NOT NULL,
  initials VARCHAR(10),
  email VARCHAR(255) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE(organization_id, email)
);
CREATE INDEX idx_users_org ON users(organization_id);

-- Sheets (the container object)
CREATE TABLE sheets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  sheet_class VARCHAR(50) NOT NULL DEFAULT 'standard', -- standard | enterprise_scale
  capacity_tier VARCHAR(50), -- 250 | 1M
  row_count BIGINT NOT NULL DEFAULT 0,
  populated_field_count BIGINT NOT NULL DEFAULT 0,
  schema_version INT NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_sheets_org ON sheets(organization_id);

-- Sheet Columns (metadata for each column)
CREATE TABLE sheet_columns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sheet_id UUID NOT NULL REFERENCES sheets(id) ON DELETE CASCADE,
  column_key VARCHAR(100) NOT NULL, -- e.g., "title", "status", "cost_variance"
  name VARCHAR(255),
  data_type VARCHAR(50), -- text, number, date, checkbox, formula, etc.
  ordinal INT,
  width INT DEFAULT 150,
  settings_json JSONB,
  formula_expression TEXT, -- "[Actual Cost] - [Budget]"
  formula_mode VARCHAR(50), -- virtual | materialized | aggregate
  is_indexed BOOLEAN DEFAULT FALSE,
  is_visible BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE(sheet_id, column_key)
);
CREATE INDEX idx_sheet_columns_sheet ON sheet_columns(sheet_id);

-- Work Order Rows (the fact table - 1M rows)
CREATE TABLE work_order_rows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sheet_id UUID NOT NULL REFERENCES sheets(id) ON DELETE CASCADE,
  row_number BIGINT NOT NULL, -- Stable position in base view, used for deep navigation

  -- Core fields
  work_order_id VARCHAR(20) NOT NULL,
  title VARCHAR(500) NOT NULL,
  facility VARCHAR(100),
  region VARCHAR(100),
  program VARCHAR(100),
  category VARCHAR(100),
  priority VARCHAR(50), -- Critical, High, Normal, Low
  status VARCHAR(50), -- New, In Progress, Complete, On Hold
  assigned_team VARCHAR(100),
  owner VARCHAR(100),

  -- Dates
  submitted_date DATE,
  due_date DATE,
  completed_date DATE,

  -- Money
  budget DECIMAL(12, 2),
  actual_cost DECIMAL(12, 2),

  -- Progress
  percent_complete INT,
  notes TEXT,

  -- Computed fields (materialized when needed)
  cost_variance DECIMAL(12, 2),
  days_open INT,
  service_level_status VARCHAR(50), -- Complete | Overdue | On Track
  risk_level VARCHAR(50), -- High | Normal
  escalated BOOLEAN DEFAULT FALSE,

  -- Concurrency
  row_version INT NOT NULL DEFAULT 1,

  -- Audit
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Indexes for work_order_rows (critical for 1M row performance)
CREATE UNIQUE INDEX idx_work_order_unique ON work_order_rows(sheet_id, work_order_id);
CREATE INDEX idx_work_order_row_number ON work_order_rows(sheet_id, row_number);
CREATE INDEX idx_work_order_search ON work_order_rows USING GIN(
  to_tsvector('english', title || ' ' || COALESCE(work_order_id, '') || ' ' || COALESCE(notes, ''))
);
CREATE INDEX idx_work_order_filter_status_due ON work_order_rows(sheet_id, status, due_date)
  WHERE status != 'Complete';
CREATE INDEX idx_work_order_filter_priority_status ON work_order_rows(sheet_id, priority, status)
  WHERE status != 'Complete';
CREATE INDEX idx_work_order_filter_region ON work_order_rows(sheet_id, region)
  WHERE status != 'Complete';
CREATE INDEX idx_work_order_updated ON work_order_rows(sheet_id, updated_at DESC);

-- Sheet Views (saved filters)
CREATE TABLE sheet_views (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sheet_id UUID NOT NULL REFERENCES sheets(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  view_type VARCHAR(50) NOT NULL DEFAULT 'filter', -- filter | report
  query_definition_json JSONB NOT NULL, -- {filters: [...], sort: [...]}
  result_count BIGINT DEFAULT 0,
  index_status VARCHAR(50) DEFAULT 'not_indexed', -- not_indexed | indexing | indexed
  version INT DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE(sheet_id, name)
);
CREATE INDEX idx_sheet_views_sheet ON sheet_views(sheet_id);

-- View Position Index (for deep pagination in saved views)
CREATE TABLE view_rows (
  view_id UUID NOT NULL REFERENCES sheet_views(id) ON DELETE CASCADE,
  logical_position BIGINT NOT NULL,
  row_id UUID NOT NULL,
  PRIMARY KEY (view_id, logical_position),
  UNIQUE(view_id, row_id)
);
CREATE INDEX idx_view_rows_position ON view_rows(view_id, logical_position);

-- Automation Rules
CREATE TABLE automation_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sheet_id UUID NOT NULL REFERENCES sheets(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  enabled BOOLEAN DEFAULT TRUE,

  trigger_definition_json JSONB NOT NULL,
  condition_definition_json JSONB NOT NULL,
  action_definition_json JSONB NOT NULL,

  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_automation_rules_sheet ON automation_rules(sheet_id);

-- Outbox Events (work queue for async processing)
CREATE TABLE outbox_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sheet_id UUID NOT NULL REFERENCES sheets(id) ON DELETE CASCADE,
  row_id UUID NOT NULL,
  event_type VARCHAR(50) NOT NULL, -- row_created | cell_updated | row_updated
  changed_fields_json JSONB,
  payload_json JSONB,
  status VARCHAR(50) NOT NULL DEFAULT 'pending', -- pending | processing | completed | failed
  attempt_count INT DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMP
);
CREATE INDEX idx_outbox_pending ON outbox_events(status, created_at)
  WHERE status IN ('pending', 'processing');

-- Activity Events (immutable audit trail)
CREATE TABLE activity_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sheet_id UUID NOT NULL REFERENCES sheets(id) ON DELETE CASCADE,
  row_id UUID NOT NULL,
  actor_id UUID,
  source_type VARCHAR(50) NOT NULL, -- user_edit | automation | form_submission | system
  action_type VARCHAR(50) NOT NULL, -- field_changed | comment_added | rule_triggered
  changes_json JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_activity_row ON activity_events(sheet_id, row_id, created_at DESC);
CREATE INDEX idx_activity_sheet ON activity_events(sheet_id, created_at DESC);

-- Row Comments
CREATE TABLE row_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sheet_id UUID NOT NULL REFERENCES sheets(id) ON DELETE CASCADE,
  row_id UUID NOT NULL,
  author_id UUID REFERENCES users(id) ON DELETE SET NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_row_comments_row ON row_comments(sheet_id, row_id, created_at DESC);

-- Row Attachments
CREATE TABLE row_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sheet_id UUID NOT NULL REFERENCES sheets(id) ON DELETE CASCADE,
  row_id UUID NOT NULL,
  file_name VARCHAR(255) NOT NULL,
  content_type VARCHAR(100),
  size_bytes BIGINT,
  storage_key VARCHAR(500), -- Path or S3 key
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_row_attachments_row ON row_attachments(sheet_id, row_id);

-- Sessions (track active browsers for real-time updates)
CREATE TABLE sessions (
  id VARCHAR(100) PRIMARY KEY,
  sheet_id UUID NOT NULL REFERENCES sheets(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  display_name VARCHAR(255),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_sessions_sheet ON sessions(sheet_id);

-- Forms (for collecting submissions)
CREATE TABLE forms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sheet_id UUID NOT NULL REFERENCES sheets(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  fields_json JSONB NOT NULL, -- [{key: "title", name: "Title", required: true}, ...]
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_forms_sheet ON forms(sheet_id);

-- Form Submissions
CREATE TABLE form_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  form_id UUID NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
  row_id UUID NOT NULL,
  submitted_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_submissions_form ON form_submissions(form_id, submitted_at DESC);

-- Reports (saved query definitions)
CREATE TABLE reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sheet_id UUID NOT NULL REFERENCES sheets(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  definition_json JSONB NOT NULL, -- {columns: [...], filters: [...], groupBy: [...], metrics: [...]}
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_reports_sheet ON reports(sheet_id);
