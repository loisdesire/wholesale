import { tenantRoot } from "@/lib/prisma";

export type IsolationStatus = {
  /** True when the application's connection is subject to row-level security. */
  enforced: boolean;
  role: string;
  problems: string[];
};

/**
 * Is tenant isolation actually in force for the connection the app uses?
 *
 * Row-level security is skipped entirely for a superuser or a role with BYPASSRLS,
 * so an app that connects as the database owner would look fine while isolating
 * nothing. This asks Postgres, so a misconfigured deployment is noticed rather than
 * assumed safe.
 */
export async function checkTenantIsolation(): Promise<IsolationStatus> {
  const [role] = await tenantRoot.$queryRaw<{ current_user: string; rolsuper: boolean; rolbypassrls: boolean }[]>`
    SELECT current_user, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`;

  const problems: string[] = [];
  if (role.rolsuper) problems.push(`role "${role.current_user}" is a superuser`);
  if (role.rolbypassrls) problems.push(`role "${role.current_user}" has BYPASSRLS`);

  const unprotected = await tenantRoot.$queryRaw<{ table: string }[]>`
    SELECT c.relname AS "table"
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'r'
       AND c.relname NOT IN ('_prisma_migrations', 'User', 'Membership', 'Organization')
       AND NOT (c.relrowsecurity AND c.relforcerowsecurity)`;
  if (unprotected.length > 0) problems.push(`no row-level security on: ${unprotected.map((t) => t.table).join(", ")}`);

  return { enforced: problems.length === 0, role: role.current_user, problems };
}
