-- Agent Flow: owner-connected platform accounts (2026-09-28).
--
-- One row per platform the owner has connected from Agent Flow → Settings →
-- Connections. Tokens are encrypted with OAUTH_SECRET (lib/token-crypto) —
-- the same envelope every CRM integration uses. Only the service role can
-- read this table: RLS is on and there are no policies, so the anon and
-- authenticated roles get nothing. The posting code (src/lib/agent-execute.ts)
-- is the only reader, and it runs behind requireAdmin on the owner's Approve.
create table if not exists agent_connections (
  provider      text primary key,          -- x | meta | youtube | linkedin
  account_label text,                      -- "@swiftcard", "SwiftCard (Page)", channel title
  account_id    text,                      -- provider-side id of the posting identity
  access_token  text not null,             -- encrypted
  refresh_token text,                      -- encrypted; null where the provider issues none
  expires_at    timestamptz,               -- null = does not expire (Meta page tokens)
  scopes        text,
  meta          jsonb not null default '{}'::jsonb, -- page id, ig user id, org urn, …
  connected_by  text,                      -- owner email that pressed Connect
  connected_at  timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
alter table agent_connections enable row level security;
