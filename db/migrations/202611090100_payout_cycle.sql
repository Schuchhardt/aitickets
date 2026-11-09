-- Payout cycle: per-org release policy, early release tracking, admin-originated payouts, and transfer receipts.
-- Supports: set_release_policy, release_event_funds, org_request_payout, upload_payout_receipt, mark_payout_paid w/ receipt.

-- 1. Per-org release policy (organizations)
alter table organizations add column if not exists release_delay_hours smallint;
alter table organizations add column if not exists release_on_flow_settlement boolean not null default false;

-- 2. Early release tracking (events)
alter table events add column if not exists released_early_at timestamptz;
alter table events add column if not exists released_early_by text;

-- 3. Early release tracking (event_dates / functions)
alter table event_dates add column if not exists released_early_at timestamptz;
alter table event_dates add column if not exists released_early_by text;

-- 4. Admin-originated payout tracking (aitickets_payouts)
alter table aitickets_payouts add column if not exists requested_by_user_id integer;
alter table aitickets_payouts add column if not exists requested_by_actor text;

-- 5. Transfer receipts
create table if not exists aitickets_payout_receipts (
    id uuid primary key default gen_random_uuid(),
    payout_id uuid not null references aitickets_payouts(id),
    organization_id integer not null,
    storage_path text not null,
    content_type text not null,
    file_size integer not null,
    file_hash text not null,
    uploaded_by text not null,
    created_at timestamptz not null default now()
);

create index if not exists idx_payout_receipts_payout on aitickets_payout_receipts(payout_id);
