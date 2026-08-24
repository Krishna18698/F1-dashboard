-- Durable store for a finished round's classification.
--
-- Run once in the Supabase SQL editor. Everything the app writes here is PROVISIONAL: the
-- classification as it stood at the chequered flag, plus whatever the post-race re-check finds.
-- Jolpica's official numbers supersede it entirely once published (~21 h for the 2026 Dutch GP).

create table if not exists round_result (
  round        integer primary key,
  session_name text        not null,
  -- [{ "pos": 1, "tla": "NOR" }, ...] in finishing order.
  places       jsonb       not null,
  captured_at  bigint      not null,   -- epoch ms, when first stored (at the flag)
  rechecked_at bigint                  -- epoch ms, when the stewards re-check ran; null until then
);

-- The service role key bypasses RLS, and only server-side code holds that key — no browser ever
-- talks to this table. RLS is still enabled so an anon key cannot read or write it by accident.
alter table round_result enable row level security;
