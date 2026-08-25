// Shared types used across web, server, and worker

export interface WorkOrderRow {
  id: string;
  sheet_id: string;
  row_number: number;
  work_order_id: string;
  title: string;
  facility: string | null;
  region: string | null;
  program: string | null;
  category: string | null;
  priority: string | null;
  status: string | null;
  assigned_team: string | null;
  owner: string | null;
  submitted_date: string | null;
  due_date: string | null;
  completed_date: string | null;
  budget: number | null;
  actual_cost: number | null;
  cost_variance: number | null;
  percent_complete: number | null;
  days_open: number | null;
  service_level_status: string | null;
  risk_level: string | null;
  escalated: boolean;
  notes: string | null;
  row_version: number;
  created_at: string;
  updated_at: string;
}

export interface SheetColumn {
  id: string;
  sheet_id: string;
  column_key: string;
  name: string;
  data_type: string;
  ordinal: number;
  width: number;
  formula_expression: string | null;
  formula_mode: 'virtual' | 'materialized' | 'aggregate' | null;
  is_indexed: boolean;
  is_visible: boolean;
}

export interface Sheet {
  id: string;
  organization_id: string;
  name: string;
  sheet_class: 'standard' | 'enterprise_scale';
  capacity_tier: string | null;
  row_count: number;
  populated_field_count: number;
  created_at: string;
  updated_at: string;
}

export interface SheetView {
  id: string;
  sheet_id: string;
  name: string;
  view_type: 'filter' | 'report';
  query_definition_json: Record<string, any>;
  result_count: number;
  index_status: 'not_indexed' | 'indexing' | 'indexed';
  version: number;
}

// API Responses

export interface RowWindowResponse {
  view_id: string;
  start: number;
  limit: number;
  total_count: number;
  rows: WorkOrderRow[];
  query_duration_ms: number;
  cached: boolean;
  next_cursor?: string;
}

export interface CellUpdateRequest {
  value: any;
  expected_version: number;
}

export interface CellUpdateResponse {
  success: boolean;
  row_version?: number;
  updated_at?: string;
  conflict?: boolean;
  current_row?: WorkOrderRow;
  current_version?: number;
}

export interface SearchRequest {
  query: string;
  limit?: number;
}

export interface SearchResult {
  row_id: string;
  row_number: number;
  work_order_id: string;
  title: string;
  snippet?: string;
}

export interface SearchResponse {
  results: SearchResult[];
  total_count: number;
  query_duration_ms: number;
}

export interface FilterCondition {
  field: string;
  operator: string;
  value?: any;
  values?: any[];
}

export interface FilterRequest {
  filters: FilterCondition[];
  sort?: { field: string; direction: 'asc' | 'desc' }[];
  limit?: number;
  offset?: number;
}

export interface ScaleInspectorResponse {
  database_row_count: number;
  populated_field_estimate: number;
  current_client_window: {
    start: number;
    size: number;
  };
  browser_cached_rows: number;
  last_query_duration_ms: number;
  last_query_cached: boolean;
  last_edit_persist_ms: number;
  last_automation_ms: number;
  websocket_status: 'disconnected' | 'connecting' | 'connected';
}

export interface CapacityResponse {
  sheet_id: string;
  current_tier: string;
  total_rows: number;
  populated_fields: number;
  indexed_columns: number;
  formula_columns: number;
  automation_rules: number;
  available_rows: number;
  usage_percent: number;
  tiers: {
    name: string;
    rows: number;
    price: number;
    current: boolean;
  }[];
}

export interface FormSubmissionRequest {
  title: string;
  facility: string;
  region: string;
  category: string;
  priority: string;
  due_date: string;
  budget: number;
  notes: string;
  [key: string]: any;
}

export interface FormSubmissionResponse {
  row_id: string;
  work_order_id: string;
  row_number: number;
}

export interface ActivityEvent {
  id: string;
  sheet_id: string;
  row_id: string;
  actor_id: string | null;
  source_type: 'user_edit' | 'automation' | 'form_submission' | 'system';
  action_type: string;
  changes_json: Record<string, any>;
  created_at: string;
}

export interface AutomationExecution {
  id: string;
  rule_name: string;
  row_id: string;
  triggered_at: string;
  status: 'completed' | 'failed';
  actions_taken: Record<string, any>[];
  duration_ms: number;
}

export interface ReportDefinition {
  id: string;
  sheet_id: string;
  name: string;
  definition_json: Record<string, any>;
}

export interface User {
  id: string;
  organization_id: string;
  display_name: string;
  email: string;
}

export interface Session {
  id: string;
  sheet_id: string;
  user_id: string | null;
  display_name: string;
  created_at: string;
  last_seen_at: string;
}

// WebSocket Events

export type WebSocketEventType =
  | 'cell_updated'
  | 'row_created'
  | 'row_deleted'
  | 'automation_completed'
  | 'session_joined'
  | 'session_left'
  | 'comment_added';

export interface WebSocketEvent {
  type: WebSocketEventType;
  sheet_id: string;
  data: Record<string, any>;
}

export interface CellUpdatedEvent extends WebSocketEvent {
  type: 'cell_updated';
  data: {
    row_id: string;
    row_number: number;
    column_key: string;
    value: any;
    actor: string;
    row_version: number;
  };
}

export interface RowCreatedEvent extends WebSocketEvent {
  type: 'row_created';
  data: {
    row_id: string;
    row_number: number;
    row: WorkOrderRow;
  };
}

// Database Query Helpers

export interface QueryOptions {
  cache?: boolean;
  timeout?: number;
}

export interface QueryResult<T> {
  rows: T[];
  rowCount: number;
  duration_ms: number;
}
