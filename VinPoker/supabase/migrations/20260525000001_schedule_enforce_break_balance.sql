-- Source-catalog containment: retain extension availability without scheduling
-- an HTTP job against an environment-specific endpoint. Scheduling requires a
-- new owner-gated runtime-config migration after Preview UAT.

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;
