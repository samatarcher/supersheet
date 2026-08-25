import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import staticPlugin from '@fastify/static';
import { initDb, closeDb } from './db';
import * as db from './db';
import { v4 as uuidv4 } from 'uuid';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config();

const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL || 'info',
  },
});

// CORS
await app.register(cors, {
  origin: process.env.WEB_URL || 'http://localhost:5173',
  credentials: true,
});

// WebSockets
await app.register(websocket);

// Static files (serve built web app)
const webDistPath = path.join(process.cwd(), 'web/dist');
try {
  await app.register(staticPlugin, {
    root: webDistPath,
    prefix: '/',
  });
} catch (err) {
  console.log('Web dist directory not found yet (will be created on first build)');
}

// Initialize database
const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) {
  console.error('DATABASE_URL not set');
  process.exit(1);
}

initDb(dbUrl);
console.log('Database connected');

// Track WebSocket connections for broadcasting
const connections = new Map<string, any>();

// === Health Check ===
app.get('/api/health', async (request, reply) => {
  return { status: 'ok' };
});

// === Sheet and View Endpoints ===
app.get<{ Params: { sheet_id: string } }>('/api/sheets/:sheet_id', async (request, reply) => {
  const { sheet_id } = request.params;
  const sheet = await db.getSheet(sheet_id);
  if (!sheet) {
    return reply.status(404).send({ error: 'Sheet not found' });
  }
  return sheet;
});

app.get<{ Params: { sheet_id: string } }>('/api/sheets/:sheet_id/columns', async (request, reply) => {
  const { sheet_id } = request.params;
  const columns = await db.getSheetColumns(sheet_id);
  return columns;
});

app.get<{ Params: { sheet_id: string } }>('/api/sheets/:sheet_id/views', async (request, reply) => {
  const { sheet_id } = request.params;
  const views = await db.getSheetViews(sheet_id);
  return views;
});

// === Row Window (Core Pagination) ===
app.get<{ Params: { view_id: string }; Querystring: { start?: string; limit?: string } }>(
  '/api/views/:view_id/window',
  async (request, reply) => {
    const { view_id } = request.params;
    const start = parseInt(request.query.start || '0', 10);
    const limit = parseInt(request.query.limit || '200', 10);

    const { rows, totalCount, duration, cached } = await db.getRowWindow(view_id, start, limit);

    return {
      view_id,
      start,
      limit,
      total_count: totalCount,
      rows,
      query_duration_ms: duration,
      cached,
    };
  }
);

// === Search ===
app.post<{ Params: { sheet_id: string }; Body: { query: string; limit?: number } }>(
  '/api/sheets/:sheet_id/search',
  async (request, reply) => {
    const { sheet_id } = request.params;
    const { query, limit = 20 } = request.body;

    if (!query || query.length < 2) {
      return reply.status(400).send({ error: 'Query must be at least 2 characters' });
    }

    const { rows, duration } = await db.searchWorkOrders(sheet_id, query, limit);

    return {
      results: rows.map((row) => ({
        row_id: row.id,
        row_number: row.row_number,
        work_order_id: row.work_order_id,
        title: row.title,
      })),
      total_count: rows.length,
      query_duration_ms: duration,
    };
  }
);

// === Filter & Sort ===
app.post<{
  Params: { view_id: string };
  Body: {
    filters?: { field: string; operator: string; value?: any; values?: any[] }[];
    sort?: { field: string; direction: 'asc' | 'desc' }[];
  };
}>('/api/views/:view_id/apply_filters', async (request, reply) => {
  const { view_id } = request.params;
  const { filters = [], sort = [] } = request.body;

  const startTime = Date.now();
  const { rows, totalCount } = await db.applyFiltersAndSort(view_id, filters, sort);
  const duration = Date.now() - startTime;

  return {
    view_id,
    result_count: totalCount,
    rows,
    query_duration_ms: duration,
  };
});

// === Cell Update ===
app.patch<{
  Params: { sheet_id: string; row_id: string; column_key: string };
  Body: { value: any; expected_version: number };
}>('/api/sheets/:sheet_id/rows/:row_id/cells/:column_key', async (request, reply) => {
  const { sheet_id, row_id, column_key } = request.params;
  const { value, expected_version } = request.body;

  const result = await db.updateCell(row_id, column_key, value, expected_version);

  if (!result.success) {
    if (result.conflict) {
      return reply.status(409).send({
        success: false,
        conflict: true,
        current_row: result.currentRow,
        current_version: result.currentVersion,
      });
    }
    return reply.status(500).send({ success: false });
  }

  // Broadcast to WebSocket clients
  const row = await db.getRow(row_id);
  if (row) {
    broadcastToSheet(sheet_id, {
      type: 'cell_updated',
      data: {
        row_id,
        row_number: row.row_number,
        column_key,
        value,
        row_version: result.newVersion,
      },
    });
  }

  return {
    success: true,
    row_version: result.newVersion,
    updated_at: new Date().toISOString(),
  };
});

// === Form Submission ===
app.post<{
  Params: { form_id: string };
  Body: Record<string, any>;
}>('/api/forms/:form_id/submit', async (request, reply) => {
  // For now, we'll extract sheet_id from form (in reality, look it up)
  // This is a simplified version
  const { form_id } = request.params;

  // In a full implementation, look up the form and its sheet_id
  // For now, assume sheet_id is passed in the request or we get it from form metadata
  // Let's use the first sheet as demo
  const sheets = await db.getPool().then((p) => p.query(`SELECT id FROM sheets LIMIT 1`));
  if (sheets.rows.length === 0) {
    return reply.status(500).send({ error: 'No sheet configured' });
  }

  const sheetId = sheets.rows[0].id;

  const result = await db.insertWorkOrder(sheetId, request.body);

  // Broadcast new row to connected clients
  const newRow = await db.getRow(result.row_id);
  if (newRow) {
    broadcastToSheet(sheetId, {
      type: 'row_created',
      data: {
        row_id: result.row_id,
        row_number: result.row_number,
        row: newRow,
      },
    });
  }

  return result;
});

// === Activity Log ===
app.get<{ Params: { sheet_id: string; row_id: string }; Querystring: { limit?: string } }>(
  '/api/sheets/:sheet_id/rows/:row_id/activity',
  async (request, reply) => {
    const { sheet_id, row_id } = request.params;
    const limit = parseInt(request.query.limit || '50', 10);

    const activity = await db.getRowActivity(sheet_id, row_id, limit);
    return { activity };
  }
);

// === Scale Inspector (Demo) ===
app.get<{ Querystring: { sheet_id?: string } }>('/api/demo/scale_inspector', async (request, reply) => {
  // Get first sheet if not specified
  const sheetId = request.query.sheet_id || (await getDefaultSheetId());
  if (!sheetId) {
    return reply.status(500).send({ error: 'No sheet configured' });
  }

  const scaleData = await db.getScaleInspectorData(sheetId);
  const capacity = await db.getCapacity(sheetId);

  return {
    database_row_count: scaleData.database_row_count,
    populated_field_estimate: scaleData.populated_field_estimate,
    current_client_window: { start: 0, size: 200 },
    browser_cached_rows: 0, // Will be updated by client
    last_query_duration_ms: 0,
    last_query_cached: false,
    last_edit_persist_ms: 0,
    last_automation_ms: 0,
    websocket_status: 'disconnected',
  };
});

// === Capacity Info ===
app.get<{ Params: { sheet_id: string } }>('/api/sheets/:sheet_id/capacity', async (request, reply) => {
  const { sheet_id } = request.params;
  const capacity = await db.getCapacity(sheet_id);

  const pricingTier250 = parseInt(process.env.DEMO_PRICE_250 || '4999', 10);
  const pricingTier1M = parseInt(process.env.DEMO_PRICE_1M || '9999', 10);

  return {
    sheet_id,
    current_tier: capacity.current_tier,
    total_rows: capacity.total_rows,
    populated_fields: capacity.populated_fields,
    tiers: [
      {
        name: 'Enterprise Scale 250',
        rows: 250000,
        price: pricingTier250,
        current: capacity.current_tier === '250',
      },
      {
        name: 'Enterprise Scale 1M',
        rows: 1000000,
        price: pricingTier1M,
        current: capacity.current_tier === '1M',
      },
    ],
  };
});

// === Demo Reset (only in demo mode) ===
if (process.env.DEMO_MODE === 'true') {
  app.post('/api/demo/reset', async (request, reply) => {
    console.log('⚠️  Demo reset requested');
    try {
      const pool = await db.getPool();

      // Clear relevant tables
      await pool.query('TRUNCATE TABLE activity_events');
      await pool.query('TRUNCATE TABLE outbox_events');
      await pool.query('TRUNCATE TABLE row_comments');
      await pool.query('TRUNCATE TABLE view_rows');
      await pool.query('TRUNCATE TABLE work_order_rows RESTART IDENTITY');

      console.log('✓ Demo reset complete');
      return { status: 'reset' };
    } catch (error) {
      console.error('Reset error:', error);
      return reply.status(500).send({ error: 'Reset failed' });
    }
  });

  app.post<{ Querystring: { user: string } }>('/api/demo/switch_user', async (request, reply) => {
    // In a real implementation, set session user
    return { current_user: request.query.user || 'alice' };
  });
}

// === WebSocket for Real-Time Updates ===
app.get<{ Querystring: { sheet_id: string; session_id?: string; user_name?: string } }>(
  '/api/ws',
  { websocket: true },
  async (socket, req) => {
    const sheetId = req.query.sheet_id;
    const sessionId = req.query.session_id || uuidv4();
    const userName = req.query.user_name || 'Anonymous';

    if (!sheetId) {
      socket.send(JSON.stringify({ error: 'sheet_id required' }));
      socket.close();
      return;
    }

    // Store connection
    const key = `${sheetId}:${sessionId}`;
    connections.set(key, { socket, sheetId, sessionId, userName });

    console.log(`WebSocket connected: ${key}`);

    socket.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        console.log('WebSocket message:', msg);
        // Handle incoming messages (heartbeats, client state, etc.)
      } catch (e) {
        console.error('WebSocket parse error:', e);
      }
    });

    socket.on('close', () => {
      connections.delete(key);
      console.log(`WebSocket closed: ${key}`);
      // Broadcast session left
      broadcastToSheet(sheetId, {
        type: 'session_left',
        data: { session_id: sessionId, user_name: userName },
      });
    });

    // Send connection confirmation
    socket.send(
      JSON.stringify({
        type: 'connected',
        session_id: sessionId,
        user_name: userName,
      })
    );
  }
);

function broadcastToSheet(sheetId: string, event: any) {
  for (const [key, conn] of connections.entries()) {
    if (conn.sheetId === sheetId && conn.socket.readyState === 1) {
      // readyState 1 = OPEN
      try {
        conn.socket.send(JSON.stringify(event));
      } catch (e) {
        console.error('Broadcast error:', e);
      }
    }
  }
}

async function getDefaultSheetId(): Promise<string | null> {
  const pool = await db.getPool();
  const res = await pool.query('SELECT id FROM sheets LIMIT 1');
  return res.rows[0]?.id || null;
}

// === Startup & Shutdown ===
const port = parseInt(process.env.PORT || '3000', 10);

try {
  await app.listen({ port, host: '0.0.0.0' });
  console.log(`🚀 Server running on http://localhost:${port}`);
  console.log(`   API: http://localhost:${port}/api`);
  console.log(`   WebSocket: ws://localhost:${port}/api/ws`);
  console.log(`   Demo mode: ${process.env.DEMO_MODE === 'true' ? 'enabled' : 'disabled'}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down...');
  await app.close();
  await closeDb();
  process.exit(0);
});
