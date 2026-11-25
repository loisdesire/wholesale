import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { saveReportView, ReportViewError } from "@/lib/report-views";

describe("saveReportView validation", () => {
  let organizationId: string;
  let userId: string;

  beforeAll(async () => {
    const org = await prisma.organization.create({ data: { name: "Report Views Validation Org" } });
    organizationId = org.id;
    const user = await prisma.user.create({
      data: { email: "report-views-validation@example.com", passwordHash: "x", name: "RV", memberships: { create: { organizationId, role: "OWNER" } } },
    });
    userId = user.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("rejects an invalid date with a friendly error, not a database error", async () => {
    await expect(
      saveReportView({ organizationId, createdById: userId, name: "Bad", from: new Date("nonsense"), to: new Date("2026-01-02") })
    ).rejects.toBeInstanceOf(ReportViewError);
    await expect(
      saveReportView({ organizationId, createdById: userId, name: "Bad", from: new Date(""), to: new Date("") })
    ).rejects.toThrow(/valid start and end date/);
  });
});
