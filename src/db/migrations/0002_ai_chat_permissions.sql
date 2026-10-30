-- AI chat: default permissions of the system roles, on existing databases
-- (the seed only runs on an empty database). Idempotent.
--   Administrateur (…0001): ai_chat:use + ai_chat:write
--   Manager (…0002)       : ai_chat:use (read-only)
--   Super Administrateur  : nothing to insert (isAdmin bypass)
--   Membre+ and Membre    : no permission (the administrator grants access)
INSERT INTO "role_permissions" ("role_id", "permission")
SELECT r."id", p."permission"
FROM "roles" r
JOIN (VALUES
  ('00000000-0000-0000-0000-000000000001', 'ai_chat:use'),
  ('00000000-0000-0000-0000-000000000001', 'ai_chat:write'),
  ('00000000-0000-0000-0000-000000000002', 'ai_chat:use')
) AS p("role_id", "permission") ON r."id" = p."role_id"::uuid
ON CONFLICT ("role_id", "permission") DO NOTHING;
