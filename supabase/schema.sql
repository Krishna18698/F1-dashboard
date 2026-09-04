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

-- Most recently completed session of ANY type — practice, qualifying, sprint or race.
--
-- Separate from round_result on purpose: that table is keyed by round and feeds championship
-- points, so a practice classification must never land in it. This one exists only to keep the
-- hero's results ticker fed during the gap between the live socket closing (5 min after a
-- session ends) and F1's static archive publishing the meeting (hours later, sometimes not at
-- all until the weekend is over).
create table if not exists session_result (
  session_name text primary key,          -- e.g. "Italian Grand Prix · Practice 1"
  mode         text   not null,           -- race | quali | practice
  -- [{ "pos": 1, "tla": "NOR", "team_colour": "F47600", "best": 84.194, "gap": "" }, ...]
  top          jsonb  not null,
  ended_at     bigint not null,           -- epoch ms, when the session ended (ordering key)
  captured_at  bigint not null            -- epoch ms, when this snapshot was written
);

-- Same reasoning as round_result: only server-side code holds the service role key, which
-- bypasses RLS. Enabled anyway so an anon key cannot read or write it by accident.
alter table session_result enable row level security;
