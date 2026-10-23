import { checkTenantIsolation } from "../src/lib/isolation-check";

checkTenantIsolation()
  .then((status) => {
    if (status.enforced) {
      console.log(`✓ Tenant isolation is enforced (connected as "${status.role}").`);
      process.exit(0);
    }
    console.error(`✗ Tenant isolation is NOT enforced: ${status.problems.join("; ")}`);
    process.exit(1);
  })
  .catch((err) => {
    console.error("Could not check:", err instanceof Error ? err.message : err);
    process.exit(2);
  });
