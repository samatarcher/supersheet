# SuperSheet Local Development Setup

## Prerequisites

- Node.js 18+
- Docker & Docker Compose (for PostgreSQL)
- npm or yarn

## Quick Start

### 1. Clone and Install Dependencies

```bash
cd C:\python\supersheet
npm install
npm install --prefix web
npm install --prefix server
npm install --prefix db
```

### 2. Start PostgreSQL

```bash
docker-compose up -d
```

This starts a PostgreSQL container on `localhost:5432`.

### 3. Create .env File

```bash
cp .env.example .env
```

The defaults in `.env.example` should work for local development.

### 4. Run Database Migrations

```bash
npm run db:migrate
```

This creates all tables defined in `db/migrations/001_init.sql`.

### 5. Seed the Database

```bash
npm run db:seed
```

This generates 1 million work order rows deterministically. This takes 2-5 minutes depending on your machine.

**To seed fewer rows for faster testing:**

```bash
SEED_ROW_COUNT=10000 npm run db:seed
```

### 6. Start the Development Servers

In two separate terminals:

**Terminal 1 - API Server:**
```bash
npm run dev:server
```

Server starts on `http://localhost:3000`

**Terminal 2 - Web App:**
```bash
npm run dev:web
```

Web app starts on `http://localhost:5173`

### 7. Open in Browser

Navigate to `http://localhost:5173`

You should see:
- Title: "National Facilities Work Order Register"
- Enterprise Scale badge
- Row count: "1,000,000 rows"
- Empty grid (waiting to fetch first window)
- Toolbar with "Go to row" control

---

## Folder Structure

```
supersheet/
├── db/                 # Database migrations and seed
│   ├── migrations/     # SQL migration files
│   ├── seed/          # Seed script (TypeScript)
│   ├── scripts/       # Migration runner
│   └── package.json
│
├── server/            # Node.js + Fastify API
│   ├── src/
│   │   ├── index.ts   # Main server
│   │   └── db.ts      # Database utilities
│   └── package.json
│
├── web/               # React + Vite
│   ├── src/
│   │   ├── main.tsx
│   │   ├── App.tsx
│   │   └── components/Grid.tsx
│   ├── index.html
│   └── package.json
│
├── shared/            # Shared types
│   └── src/types.ts
│
├── docs/              # Documentation
├── REQUIREMENTS.md    # Checklist tracker
├── package.json       # Monorepo root
└── docker-compose.yml # PostgreSQL container
```

---

## Useful Commands

### One-Shot Setup
```bash
npm run setup
```

This installs all dependencies, runs migrations, and seeds the database in one command.

### Reset Database
```bash
npm run db:reset
```

Clears all data and reseeds (useful after testing).

### Type Check
```bash
npm run type-check
```

Validates TypeScript across all modules.

### Build for Production
```bash
npm run build
```

---

## Troubleshooting

### "Database connection refused"
- Make sure PostgreSQL container is running: `docker-compose ps`
- Start it: `docker-compose up -d`
- Check DATABASE_URL in `.env`

### "Port 3000/5173 already in use"
- Change port in server: `PORT=3001 npm run dev:server`
- Change port in web: `npm run dev:web -- --port 5174`

### "Seed script takes too long"
- Test with fewer rows: `SEED_ROW_COUNT=100000 npm run db:seed`
- Use a smaller count for development

### Grid is empty or says "No rows found"
- Verify database was seeded: `psql postgresql://postgres:postgres@localhost/supersheet -c "SELECT COUNT(*) FROM work_order_rows;"`
- Check server logs for errors
- Check browser console (F12) for network errors

---

## Next Steps

Once this is running, you have Phase 1 foundation complete:

1. ✓ Database with 1M rows
2. ✓ Row window API
3. ✓ React grid with Glide Data Grid
4. ✓ Basic navigation

Phase 1 gate: "Navigate 1M rows, jump to row 750k, show exact DB count"

To advance to Phase 2, implement:
- Search API + UI
- Filter & Sort
- Cell editing with row versioning
- Activity log
