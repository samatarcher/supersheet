import { Pool, QueryResult } from 'pg';
import { WorkOrderRow, SheetView, QueryResult as CustomQueryResult } from '../../shared/src/types';

let pool: Pool;

export function initDb(connectionString: string) {
  pool = new Pool({
    connectionString,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
  });

  pool.on('error', (err) => {
    console.error('Unexpected error on idle client', err);
  });

  return pool;
}

export async function getPool(): Promise<Pool> {
  return pool;
}

export async function closeDb() {
  if (pool) {
    await pool.end();
  }
}

// Cached query results (simple in-memory LRU)
const queryCache = new Map<string, { data: any; timestamp: number }>();
const CACHE_TTL = 5000; // 5 seconds

function cacheKey(...parts: any[]): string {
  return parts.map((p) => JSON.stringify(p)).join(':');
}

function getFromCache(key: string): any | null {
  const cached = queryCache.get(key);
  if (!cached) return null;
  if (Date.now() - cached.timestamp > CACHE_TTL) {
    queryCache.delete(key);
    return null;
  }
  return cached.data;
}

function setCache(key: string, data: any) {
  queryCache.set(key, { data, timestamp: Date.now() });
  // Limit cache size
  if (queryCache.size > 100) {
    const firstKey = queryCache.keys().next().value;
    queryCache.delete(firstKey);
  }
}

// Row Window Query (the core pagination API)
export async function getRowWindow(
  viewId: string,
  start: number,
  limit: number
): Promise<{ rows: WorkOrderRow[]; totalCount: number; duration: number; cached: boolean }> {
  const key = cacheKey('row_window', viewId, start, limit);
  const cached = getFromCache(key);
  if (cached) {
    return { ...cached, cached: true };
  }

  const startTime = Date.now();

  // Get total count for the view
  const countRes = await pool.query(
    `SELECT result_count FROM sheet_views WHERE id = $1`,
    [viewId]
  );
  const totalCount = countRes.rows[0]?.result_count || 0;

  // Get rows using logical position from view_rows index
  const res = await pool.query<WorkOrderRow>(
    `
    SELECT w.*
    FROM work_order_rows w
    INNER JOIN view_rows vr ON w.id = vr.row_id
    WHERE vr.view_id = $1
    ORDER BY vr.logical_position ASC
    LIMIT $2 OFFSET $3
    `,
    [viewId, limit, start]
  );

  const duration = Date.now() - startTime;

  const result = {
    rows: res.rows,
    totalCount,
    duration,
  };

  setCache(key, result);
  return { ...result, cached: false };
}

// Get a specific row
export async function getRow(rowId: string): Promise<WorkOrderRow | null> {
  const res = await pool.query<WorkOrderRow>(
    `SELECT * FROM work_order_rows WHERE id = $1`,
    [rowId]
  );
  return res.rows[0] || null;
}

// Update a cell with row versioning
export async function updateCell(
  rowId: string,
  columnKey: string,
  value: any,
  expectedVersion: number
): Promise<{ success: boolean; newVersion?: number; conflict?: boolean; currentRow?: WorkOrderRow }> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Check row version
    const versionRes = await client.query(`SELECT row_version FROM work_order_rows WHERE id = $1`, [rowId]);
    if (!versionRes.rows[0]) {
      await client.query('ROLLBACK');
      return { success: false };
    }

    const currentVersion = versionRes.rows[0].row_version;
    if (currentVersion !== expectedVersion) {
      // Version conflict
      const conflictRow = await client.query<WorkOrderRow>(
        `SELECT * FROM work_order_rows WHERE id = $1`,
        [rowId]
      );
      await client.query('ROLLBACK');
      return {
        success: false,
        conflict: true,
        currentRow: conflictRow.rows[0],
        currentVersion,
      };
    }

    // Update the row
    await client.query(
      `UPDATE work_order_rows SET ${columnKey} = $1, row_version = row_version + 1, updated_at = NOW()
       WHERE id = $2`,
      [value, rowId]
    );

    // Create activity event
    await client.query(
      `INSERT INTO activity_events (sheet_id, row_id, actor_id, source_type, action_type, changes_json, created_at)
       SELECT sheet_id, $1, NULL, 'user_edit', 'field_changed', $2, NOW()
       FROM work_order_rows WHERE id = $1`,
      [rowId, JSON.stringify({ [columnKey]: { old: null, new: value } })]
    );

    // Create outbox event for worker to process
    await client.query(
      `INSERT INTO outbox_events (sheet_id, row_id, event_type, changed_fields_json, status, created_at)
       SELECT sheet_id, $1, 'cell_updated', $2, 'pending', NOW()
       FROM work_order_rows WHERE id = $1`,
      [rowId, JSON.stringify({ [columnKey]: value })]
    );

    await client.query('COMMIT');

    return { success: true, newVersion: currentVersion + 1 };
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('updateCell error:', error);
    return { success: false };
  } finally {
    client.release();
  }
}

// Get sheet columns
export async function getSheetColumns(sheetId: string) {
  const res = await pool.query(
    `SELECT * FROM sheet_columns WHERE sheet_id = $1 ORDER BY ordinal ASC`,
    [sheetId]
  );
  return res.rows;
}

// Get sheet info
export async function getSheet(sheetId: string) {
  const res = await pool.query(`SELECT * FROM sheets WHERE id = $1`, [sheetId]);
  return res.rows[0] || null;
}

// Get views for sheet
export async function getSheetViews(sheetId: string): Promise<SheetView[]> {
  const res = await pool.query<SheetView>(
    `SELECT * FROM sheet_views WHERE sheet_id = $1 ORDER BY name ASC`,
    [sheetId]
  );
  return res.rows;
}

// Search work orders
export async function searchWorkOrders(
  sheetId: string,
  query: string,
  limit: number = 20
): Promise<{ rows: WorkOrderRow[]; duration: number }> {
  const startTime = Date.now();

  const res = await pool.query<WorkOrderRow>(
    `
    SELECT * FROM work_order_rows
    WHERE sheet_id = $1
    AND (
      to_tsvector('english', title || ' ' || work_order_id || ' ' || COALESCE(notes, ''))
      @@ plainto_tsquery('english', $2)
      OR work_order_id ILIKE $3
    )
    LIMIT $4
    `,
    [sheetId, query, `%${query}%`, limit]
  );

  return {
    rows: res.rows,
    duration: Date.now() - startTime,
  };
}

// Get demo data for scale inspector
export async function getScaleInspectorData(sheetId: string) {
  const res = await pool.query(
    `
    SELECT
      (SELECT COUNT(*) FROM work_order_rows WHERE sheet_id = $1) as row_count,
      (SELECT COUNT(*) FROM work_order_rows WHERE sheet_id = $1 AND notes IS NOT NULL) as non_empty_notes
    `,
    [sheetId]
  );

  const row = res.rows[0];
  return {
    database_row_count: parseInt(row.row_count),
    // Rough estimate: count non-null fields
    populated_field_estimate: parseInt(row.row_count) * 15 + parseInt(row.non_empty_notes),
  };
}

// Get capacity info
export async function getCapacity(sheetId: string) {
  const sheet = await getSheet(sheetId);
  return {
    sheet_id: sheetId,
    current_tier: sheet?.capacity_tier || '1M',
    total_rows: sheet?.row_count || 0,
    populated_fields: sheet?.populated_field_count || 0,
  };
}

// Get pending outbox events
export async function getPendingOutboxEvents(sheetId: string, limit: number = 100) {
  const res = await pool.query(
    `
    SELECT * FROM outbox_events
    WHERE sheet_id = $1 AND status IN ('pending', 'processing')
    ORDER BY created_at ASC
    LIMIT $2
    `,
    [sheetId, limit]
  );
  return res.rows;
}

// Mark outbox event as completed
export async function completeOutboxEvent(eventId: string) {
  await pool.query(
    `UPDATE outbox_events SET status = 'completed', processed_at = NOW() WHERE id = $1`,
    [eventId]
  );
}

// Insert new work order (for form submission)
export async function insertWorkOrder(sheetId: string, data: Record<string, any>) {
  const workOrderId = `WO-${Date.now()}`;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Get next row number
    const maxRes = await client.query(
      `SELECT MAX(row_number) as max_row FROM work_order_rows WHERE sheet_id = $1`,
      [sheetId]
    );
    const nextRowNumber = (maxRes.rows[0]?.max_row || 0) + 1;

    // Insert row
    const insertRes = await client.query(
      `
      INSERT INTO work_order_rows (
        sheet_id, row_number, work_order_id, title, facility, region, category, priority,
        status, due_date, budget, submitted_date, notes, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW(), $12, NOW(), NOW())
      RETURNING id
      `,
      [
        sheetId,
        nextRowNumber,
        workOrderId,
        data.title,
        data.facility,
        data.region,
        data.category,
        data.priority,
        'New',
        data.due_date,
        data.budget,
        data.notes,
      ]
    );

    const rowId = insertRes.rows[0].id;

    // Create activity event
    await client.query(
      `INSERT INTO activity_events (sheet_id, row_id, source_type, action_type, changes_json, created_at)
       VALUES ($1, $2, 'form_submission', 'row_created', $3, NOW())`,
      [sheetId, rowId, JSON.stringify({ work_order_id: workOrderId })]
    );

    // Create outbox event for automation
    await client.query(
      `INSERT INTO outbox_events (sheet_id, row_id, event_type, payload_json, status, created_at)
       VALUES ($1, $2, 'row_created', $3, 'pending', NOW())`,
      [sheetId, rowId, JSON.stringify({ work_order_id: workOrderId })]
    );

    await client.query('COMMIT');

    return {
      row_id: rowId,
      work_order_id: workOrderId,
      row_number: nextRowNumber,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('insertWorkOrder error:', error);
    throw error;
  } finally {
    client.release();
  }
}

// Get activity for a row
export async function getRowActivity(sheetId: string, rowId: string, limit: number = 50) {
  const res = await pool.query(
    `
    SELECT * FROM activity_events
    WHERE sheet_id = $1 AND row_id = $2
    ORDER BY created_at DESC
    LIMIT $3
    `,
    [sheetId, rowId, limit]
  );
  return res.rows;
}

// Apply filters and sort to a view
export async function applyFiltersAndSort(
  viewId: string,
  filters: { field: string; operator: string; value?: any; values?: any[] }[],
  sort: { field: string; direction: 'asc' | 'desc' }[] = []
) {
  // Build WHERE clause from filters
  const whereParts: string[] = [];
  const params: any[] = [viewId];
  let paramIndex = 2;

  const validOperators = ['=', '!=', 'contains', 'is_blank', 'is_not_blank', '>', '<', 'is_before', 'is_after', 'is_any_of'];
  const validFields = [
    'work_order_id', 'title', 'facility', 'region', 'program', 'category',
    'priority', 'status', 'assigned_team', 'owner', 'submitted_date', 'due_date',
    'completed_date', 'budget', 'actual_cost', 'percent_complete', 'escalated'
  ];

  for (const filter of filters) {
    if (!validFields.includes(filter.field) || !validOperators.includes(filter.operator)) {
      continue; // Skip invalid filters
    }

    let condition = '';
    if (filter.operator === '=') {
      condition = `w.${filter.field} = $${paramIndex++}`;
      params.push(filter.value);
    } else if (filter.operator === '!=') {
      condition = `w.${filter.field} != $${paramIndex++}`;
      params.push(filter.value);
    } else if (filter.operator === 'contains') {
      condition = `w.${filter.field}::text ILIKE $${paramIndex++}`;
      params.push(`%${filter.value}%`);
    } else if (filter.operator === 'is_blank') {
      condition = `w.${filter.field} IS NULL`;
    } else if (filter.operator === 'is_not_blank') {
      condition = `w.${filter.field} IS NOT NULL`;
    } else if (filter.operator === '>') {
      condition = `w.${filter.field} > $${paramIndex++}`;
      params.push(filter.value);
    } else if (filter.operator === '<') {
      condition = `w.${filter.field} < $${paramIndex++}`;
      params.push(filter.value);
    } else if (filter.operator === 'is_before') {
      condition = `w.${filter.field} < $${paramIndex++}`;
      params.push(filter.value);
    } else if (filter.operator === 'is_after') {
      condition = `w.${filter.field} > $${paramIndex++}`;
      params.push(filter.value);
    } else if (filter.operator === 'is_any_of') {
      condition = `w.${filter.field} = ANY($${paramIndex++})`;
      params.push(filter.values || []);
    }

    if (condition) {
      whereParts.push(condition);
    }
  }

  const whereClause = whereParts.length > 0 ? 'AND ' + whereParts.join(' AND ') : '';

  // Build ORDER BY from sort
  let orderByClause = 'ORDER BY vr.logical_position ASC';
  const validSortFields = validFields;
  if (sort && sort.length > 0) {
    const sortParts = sort
      .filter(s => validSortFields.includes(s.field))
      .map(s => `w.${s.field} ${s.direction.toUpperCase()}`)
      .slice(0, 3); // Max 3 sort fields

    if (sortParts.length > 0) {
      orderByClause = 'ORDER BY ' + sortParts.join(', ');
    }
  }

  // Count total matching rows
  const countQuery = `
    SELECT COUNT(*) as count
    FROM work_order_rows w
    INNER JOIN view_rows vr ON w.id = vr.row_id
    WHERE vr.view_id = $1 ${whereClause}
  `;

  const countRes = await pool.query(countQuery, params);
  const totalCount = parseInt(countRes.rows[0].count);

  // Fetch matching rows (first 200)
  const dataQuery = `
    SELECT w.*
    FROM work_order_rows w
    INNER JOIN view_rows vr ON w.id = vr.row_id
    WHERE vr.view_id = $1 ${whereClause}
    ${orderByClause}
    LIMIT 200
  `;

  const dataRes = await pool.query<WorkOrderRow>(dataQuery, params);

  return {
    rows: dataRes.rows,
    totalCount,
  };
}
