# SI MDB Bag Backfill

One-off script for reconciling SI customer bag totals from the legacy MDB into PostgreSQL.

## Usage

Dry run:

```bash
DATABASE_URL_SI='postgresql://...' npx tsx scripts/backfill-si-mdb-bags.ts --mode=dry-run
```

Apply:

```bash
DATABASE_URL_SI='postgresql://...' npx tsx scripts/backfill-si-mdb-bags.ts --mode=apply --marker=si-mdb-bag-backfill-2026-03-23
```

Rollback:

```bash
DATABASE_URL_SI='postgresql://...' npx tsx scripts/backfill-si-mdb-bags.ts --mode=rollback --marker=si-mdb-bag-backfill-2026-03-23
```
