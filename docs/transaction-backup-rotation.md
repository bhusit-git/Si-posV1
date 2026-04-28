# Transaction Backup Rotation (Local + Cloudflare R2)

This endpoint creates a daily transaction-history backup window using a cutoff (default `08:00` in `Asia/Bangkok`), rotates across 3 slots, writes local file, and uploads the same slot file to R2.

## Endpoint

- `GET /api/backup/transactions-rotate`
- `POST /api/backup/transactions-rotate`

Auth required via cron token:

- `Authorization: Bearer <BACKUP_CRON_TOKEN>`
- or header `x-cron-token: <BACKUP_CRON_TOKEN>`
- or query `?key=<BACKUP_CRON_TOKEN>`

Optional dry-run:

- `?dryRun=1`

## Rotation Logic

- Cutoff window: `[previous_cutoff, current_cutoff)`
- Default cutoff hour: `08:00` (Bangkok)
- Slot: `1..3` based on cutoff date
- Files overwrite by slot:
  - `transactions-history-slot-1.json`
  - `transactions-history-slot-2.json`
  - `transactions-history-slot-3.json`

## Required Environment Variables

```bash
BACKUP_CRON_TOKEN=replace-with-strong-secret

# Local destination (optional)
BACKUP_LOCAL_DIR=/absolute/path/for/local/backups

# Cutoff hour in Bangkok timezone (optional, default 8)
BACKUP_CUTOFF_HOUR=8

# R2 (S3-compatible)
BACKUP_R2_ENDPOINT=https://<accountid>.r2.cloudflarestorage.com
BACKUP_R2_BUCKET=<bucket-name>
BACKUP_R2_ACCESS_KEY_ID=<r2-access-key-id>
BACKUP_R2_SECRET_ACCESS_KEY=<r2-secret-access-key>

# Optional
BACKUP_R2_REGION=auto
BACKUP_R2_KEY_PREFIX=superice/transaction-history
BACKUP_R2_SESSION_TOKEN=
```

## Local Manual Test

```bash
curl -sS "http://127.0.0.1:8000/api/backup/transactions-rotate?dryRun=1" \
  -H "Authorization: Bearer $BACKUP_CRON_TOKEN"
```

Real run:

```bash
curl -sS "http://127.0.0.1:8000/api/backup/transactions-rotate" \
  -H "Authorization: Bearer $BACKUP_CRON_TOKEN"
```

## Scheduling at 08:00 Bangkok

### If cron uses Bangkok timezone

```cron
0 8 * * *
```

### If cron uses UTC timezone

`08:00 Asia/Bangkok` = `01:00 UTC`

```cron
0 1 * * *
```
