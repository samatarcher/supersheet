import { Pool } from 'pg';
import * as crypto from 'crypto';

// Deterministic random number generator (seeded)
class SeededRandom {
  private seed: number;

  constructor(seed: number) {
    this.seed = seed;
  }

  next(): number {
    this.seed = (this.seed * 9301 + 49297) % 233280;
    return this.seed / 233280;
  }

  nextInt(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }

  choice<T>(arr: T[]): T {
    return arr[Math.floor(this.next() * arr.length)];
  }
}

const facilities = [
  'Building A', 'Building B', 'Building C', 'Building D', 'Building E',
  'Warehouse 1', 'Warehouse 2', 'Parking Garage', 'Loading Dock', 'Courtyard'
];

const regions = [
  'Northeast', 'Southeast', 'Midwest', 'Southwest', 'West', 'Pacific'
];

const programs = [
  'Maintenance', 'Renovation', 'Safety', 'Sustainability', 'Expansion', 'IT Infrastructure'
];

const categories = [
  'HVAC', 'Electrical', 'Plumbing', 'Roofing', 'Flooring', 'Painting', 'Security',
  'IT', 'Landscaping', 'Pest Control', 'Cleaning', 'Structural'
];

const priorities = ['Critical', 'High', 'Normal', 'Low'];

const statuses = ['New', 'In Progress', 'On Hold', 'Complete'];

const teams = [
  'Emergency Response', 'Facilities Team A', 'Facilities Team B', 'Facilities Team C',
  'Contractors - Group 1', 'Contractors - Group 2', 'External - HVAC Specialist'
];

const owners = [
  'Alice Johnson', 'Bob Smith', 'Carol Davis', 'David Wilson', 'Eve Martinez',
  'Frank Brown', 'Grace Lee', 'Henry Garcia', 'Ivy Zhang', 'Jack Williams'
];

async function seed() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });

  const rowCount = parseInt(process.env.SEED_ROW_COUNT || '1000000', 10);
  console.log(`Seeding ${rowCount} work order rows...`);

  try {
    // Create org and sheet
    const orgRes = await pool.query(
      'INSERT INTO organizations (name) VALUES ($1) RETURNING id',
      ['Demo Organization']
    );
    const orgId = orgRes.rows[0].id;

    // Create two demo users
    const user1Res = await pool.query(
      'INSERT INTO users (organization_id, display_name, email) VALUES ($1, $2, $3) RETURNING id',
      [orgId, 'Alice', 'alice@demo.local']
    );
    const user1Id = user1Res.rows[0].id;

    const user2Res = await pool.query(
      'INSERT INTO users (organization_id, display_name, email) VALUES ($1, $2, $3) RETURNING id',
      [orgId, 'Bob', 'bob@demo.local']
    );
    const user2Id = user2Res.rows[0].id;

    // Create sheet
    const sheetRes = await pool.query(
      'INSERT INTO sheets (organization_id, name, sheet_class, capacity_tier, row_count) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      [orgId, 'National Facilities Work Order Register', 'enterprise_scale', '1M', rowCount]
    );
    const sheetId = sheetRes.rows[0].id;

    // Define columns
    const columns = [
      { key: 'work_order_id', name: 'Work Order ID', type: 'text' },
      { key: 'title', name: 'Title', type: 'text' },
      { key: 'facility', name: 'Facility', type: 'text' },
      { key: 'region', name: 'Region', type: 'text' },
      { key: 'program', name: 'Program', type: 'text' },
      { key: 'category', name: 'Category', type: 'text' },
      { key: 'priority', name: 'Priority', type: 'text' },
      { key: 'status', name: 'Status', type: 'text' },
      { key: 'assigned_team', name: 'Assigned Team', type: 'text' },
      { key: 'owner', name: 'Owner', type: 'text' },
      { key: 'submitted_date', name: 'Submitted Date', type: 'date' },
      { key: 'due_date', name: 'Due Date', type: 'date' },
      { key: 'completed_date', name: 'Completed Date', type: 'date' },
      { key: 'budget', name: 'Budget', type: 'currency' },
      { key: 'actual_cost', name: 'Actual Cost', type: 'currency' },
      { key: 'cost_variance', name: 'Cost Variance', type: 'formula' },
      { key: 'percent_complete', name: 'Percent Complete', type: 'number' },
      { key: 'days_open', name: 'Days Open', type: 'formula' },
      { key: 'service_level_status', name: 'Service Level Status', type: 'formula' },
      { key: 'risk_level', name: 'Risk Level', type: 'formula' },
      { key: 'escalated', name: 'Escalated', type: 'checkbox' },
      { key: 'notes', name: 'Notes', type: 'text' },
    ];

    for (let i = 0; i < columns.length; i++) {
      const col = columns[i];
      const isFormula = col.type === 'formula';
      let formulaExpr = null;

      if (col.key === 'cost_variance') formulaExpr = '[Actual Cost] - [Budget]';
      if (col.key === 'days_open')
        formulaExpr = 'IF(ISBLANK([Completed Date]), TODAY() - [Submitted Date], [Completed Date] - [Submitted Date])';
      if (col.key === 'service_level_status')
        formulaExpr = 'IF([Status] = "Complete", "Complete", IF([Due Date] < TODAY(), "Overdue", "On Track"))';
      if (col.key === 'risk_level')
        formulaExpr = 'IF(AND([Priority] = "Critical", [Service Level Status] = "Overdue"), "High", IF([Cost Variance] > 25000, "High", "Normal"))';

      await pool.query(
        `INSERT INTO sheet_columns (sheet_id, column_key, name, data_type, ordinal, formula_expression, formula_mode, is_indexed)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          sheetId,
          col.key,
          col.name,
          col.type,
          i,
          formulaExpr,
          isFormula ? 'materialized' : null,
          ['work_order_id', 'status', 'priority', 'region', 'owner'].includes(col.key)
        ]
      );
    }

    // Create a form for submissions
    await pool.query(
      `INSERT INTO forms (sheet_id, name, fields_json)
       VALUES ($1, $2, $3)`,
      [
        sheetId,
        'Submit New Work Order',
        JSON.stringify([
          { key: 'title', name: 'Work Order Title', required: true },
          { key: 'facility', name: 'Facility', required: true },
          { key: 'region', name: 'Region', required: true },
          { key: 'category', name: 'Category', required: true },
          { key: 'priority', name: 'Priority', required: true },
          { key: 'due_date', name: 'Requested Due Date', required: true },
          { key: 'budget', name: 'Estimated Budget', required: true },
          { key: 'notes', name: 'Description', required: true },
        ])
      ]
    );

    // Create base view
    await pool.query(
      `INSERT INTO sheet_views (sheet_id, name, view_type, query_definition_json, result_count, index_status)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [sheetId, 'All Work Orders', 'filter', JSON.stringify({ filters: [], sort: [] }), rowCount, 'indexed']
    );

    // Seed work orders in batches for performance
    const batchSize = 5000;
    const rng = new SeededRandom(42); // Deterministic seed

    console.log(`Inserting ${rowCount} rows in batches of ${batchSize}...`);

    for (let batch = 0; batch < rowCount / batchSize; batch++) {
      const rows = [];

      for (let i = 0; i < batchSize; i++) {
        const rowNum = batch * batchSize + i + 1;
        const workOrderId = `WO-${String(rowNum).padStart(7, '0')}`;

        // Deterministic data generation
        const submitted = new Date(2024, rng.nextInt(0, 11), rng.nextInt(1, 28));
        const dueDate = new Date(submitted);
        dueDate.setDate(dueDate.getDate() + rng.nextInt(7, 90));

        const completed = rng.next() > 0.7 ? new Date(dueDate.getTime() + rng.nextInt(0, 30) * 24 * 60 * 60 * 1000) : null;

        const budget = rng.nextInt(1000, 500000);
        const actualCost = rng.nextInt(Math.floor(budget * 0.5), Math.floor(budget * 1.5));
        const costVariance = actualCost - budget;

        rows.push({
          workOrderId,
          title: `${rng.choice(categories)} work at ${rng.choice(facilities)}`,
          facility: rng.choice(facilities),
          region: rng.choice(regions),
          program: rng.choice(programs),
          category: rng.choice(categories),
          priority: rng.choice(priorities),
          status: rng.choice(statuses),
          assignedTeam: rng.choice(teams),
          owner: rng.choice(owners),
          submittedDate: submitted.toISOString().split('T')[0],
          dueDate: dueDate.toISOString().split('T')[0],
          completedDate: completed ? completed.toISOString().split('T')[0] : null,
          budget,
          actualCost,
          costVariance,
          percentComplete: rng.nextInt(0, 100),
          notes: rng.next() > 0.8 ? `Notes for ${workOrderId}` : null,
          rowNumber: rowNum,
        });
      }

      // Bulk insert
      const valueParts = rows
        .map(
          (_, i) =>
            `($1, $${i * 15 + 2}, $${i * 15 + 3}, $${i * 15 + 4}, $${i * 15 + 5}, $${i * 15 + 6}, $${i * 15 + 7}, $${i * 15 + 8}, $${i * 15 + 9}, $${i * 15 + 10}, $${i * 15 + 11}, $${i * 15 + 12}, $${i * 15 + 13}, $${i * 15 + 14}, $${i * 15 + 15}, $${i * 15 + 16})`
        )
        .join(',');

      const params = [sheetId];
      rows.forEach((row) => {
        params.push(
          row.workOrderId,
          row.title,
          row.facility,
          row.region,
          row.program,
          row.category,
          row.priority,
          row.status,
          row.assignedTeam,
          row.owner,
          row.submittedDate,
          row.dueDate,
          row.completedDate,
          row.budget,
          row.actualCost,
          row.costVariance,
          row.percentComplete
        );
      });

      await pool.query(
        `INSERT INTO work_order_rows (
          sheet_id, work_order_id, title, facility, region, program, category,
          priority, status, assigned_team, owner, submitted_date, due_date,
          completed_date, budget, actual_cost, cost_variance, percent_complete
        ) VALUES ${valueParts}`,
        params
      );

      // Also insert into view_rows for the base "All Work Orders" view
      const viewRes = await pool.query(
        'SELECT id FROM sheet_views WHERE sheet_id = $1 AND name = $2',
        [sheetId, 'All Work Orders']
      );
      const viewId = viewRes.rows[0].id;

      // Get the row IDs we just inserted to create view positions
      const insertedRes = await pool.query(
        'SELECT id FROM work_order_rows WHERE sheet_id = $1 AND work_order_id = ANY($2)',
        [sheetId, rows.map((r) => r.workOrderId)]
      );

      const viewRowValues = insertedRes.rows
        .map((row, i) => `($1, $${i * 2 + 2}, $${i * 2 + 3})`)
        .join(',');

      const viewParams = [viewId];
      let position = batch * batchSize + 1;
      for (const row of insertedRes.rows) {
        viewParams.push(position++, row.id);
      }

      if (insertedRes.rows.length > 0) {
        await pool.query(
          `INSERT INTO view_rows (view_id, logical_position, row_id) VALUES ${viewRowValues}`,
          viewParams
        );
      }

      if ((batch + 1) % Math.ceil(rowCount / batchSize / 10) === 0) {
        const progress = Math.round(((batch + 1) / (rowCount / batchSize)) * 100);
        console.log(`  ${progress}% (${(batch + 1) * batchSize}/${rowCount} rows)`);
      }
    }

    // Create automation rule: Escalate Critical Work Orders
    await pool.query(
      `INSERT INTO automation_rules (sheet_id, name, enabled, trigger_definition_json, condition_definition_json, action_definition_json)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        sheetId,
        'Escalate Critical Work Orders',
        true,
        JSON.stringify({ events: ['row_created', 'cell_updated'], fields: ['priority', 'status'] }),
        JSON.stringify({
          operator: 'AND',
          conditions: [
            { field: 'priority', operator: '=', value: 'Critical' },
            { field: 'status', operator: '!=', value: 'Complete' }
          ]
        }),
        JSON.stringify([
          { action: 'set_field', field: 'escalated', value: true },
          { action: 'set_field', field: 'assigned_team', value: 'Emergency Response' },
          { action: 'create_activity', type: 'rule_triggered', message: 'Escalation rule applied' }
        ])
      ]
    );

    console.log('✓ Seeding complete!');
    console.log(`  Organization: ${orgId}`);
    console.log(`  Users: ${user1Id}, ${user2Id}`);
    console.log(`  Sheet: ${sheetId}`);
    console.log(`  Rows: ${rowCount}`);

    await pool.end();
  } catch (error) {
    console.error('Seed failed:', error);
    await pool.end();
    process.exit(1);
  }
}

seed();
