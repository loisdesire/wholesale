-- Notifications already carry organization-level row-level security (same as every
-- other tenant table). This adds a second layer, one level down: a notification also
-- belongs to a specific *recipient* within the organization, and reading or marking
-- one read should be confined to that recipient the same way a tenant table is confined
-- to its organization — by the database, not only by a `where userId` the application
-- has to remember every time.
--
-- The one existing policy applied to every command equally, so it can't also require
-- `app.user_id` to match: a write (`notify()`, inside an ordinary org-scoped
-- `transaction()`) legitimately creates a notification *for* someone other than
-- whoever is acting (an owner gets notified about another person's return request),
-- so INSERT must stay organization-scoped only. Reading your own notifications
-- (`unreadCount`/`listNotifications`) and marking them read (`markRead`/`markAllRead`)
-- are always done as a specific person, so those get a second condition: the row's
-- `userId` must equal the connection's `app.user_id` (set by `userScopedDb` in
-- src/lib/db.ts). With `app.user_id` unset, `current_setting(..., true)` returns NULL
-- and `"userId" = NULL` is never true — fails closed, exactly like the organization
-- check already does.

DROP POLICY "tenant_isolation" ON "Notification";

CREATE POLICY "notification_select" ON "Notification"
  FOR SELECT
  USING (
    "organizationId" = current_setting('app.organization_id', true)
    AND "userId" = current_setting('app.user_id', true)
  );

CREATE POLICY "notification_insert" ON "Notification"
  FOR INSERT
  WITH CHECK ("organizationId" = current_setting('app.organization_id', true));

CREATE POLICY "notification_update" ON "Notification"
  FOR UPDATE
  USING (
    "organizationId" = current_setting('app.organization_id', true)
    AND "userId" = current_setting('app.user_id', true)
  )
  WITH CHECK (
    "organizationId" = current_setting('app.organization_id', true)
    AND "userId" = current_setting('app.user_id', true)
  );

-- No DELETE policy: nothing deletes a notification, and FORCE ROW LEVEL SECURITY
-- with no DELETE policy means the restricted role simply can't (fails closed there too).
