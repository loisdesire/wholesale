import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PaystackError } from "@/lib/payments";
import { PLAN_LIMITS } from "@/lib/billing";
import { findOrCreatePaystackPlan, createPaystackSubscription } from "@/lib/subscriptions";

function plansResponse(data: { plan_code: string; name: string; amount: number; interval: string }[]) {
  return new Response(JSON.stringify({ status: true, message: "Plans retrieved", data }), { status: 200 });
}

describe("findOrCreatePaystackPlan", () => {
  beforeEach(() => {
    process.env.PAYSTACK_SECRET_KEY = "subs-test-secret";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("refuses when Paystack isn't configured", async () => {
    delete process.env.PAYSTACK_SECRET_KEY;
    await expect(findOrCreatePaystackPlan("STARTER")).rejects.toBeInstanceOf(PaystackError);
  });

  it("reuses an existing plan by name rather than creating a duplicate", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      plansResponse([{ plan_code: "PLN_existing_starter", name: "Wholesale Starter", amount: PLAN_LIMITS.STARTER.monthlyFeeCents, interval: "monthly" }])
    );
    vi.stubGlobal("fetch", fetchMock);

    const code = await findOrCreatePaystackPlan("STARTER");
    expect(code).toBe("PLN_existing_starter");
    // Only the list call was made — no POST to create a second plan.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0].toString()).toContain("/plan?");
  });

  it("creates the plan when this Paystack account has never had one for this tier", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(plansResponse([])) // list: nothing yet
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: true, data: { plan_code: "PLN_new_growth" } }), { status: 200 })); // create
    vi.stubGlobal("fetch", fetchMock);

    const code = await findOrCreatePaystackPlan("GROWTH");
    expect(code).toBe("PLN_new_growth");
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const createCall = fetchMock.mock.calls[1];
    expect(createCall[1].method).toBe("POST");
    const body = JSON.parse(createCall[1].body);
    expect(body).toMatchObject({ name: "Wholesale Growth", amount: PLAN_LIMITS.GROWTH.monthlyFeeCents, interval: "monthly", currency: "NGN" });
  });

  it("pages through the plan list before deciding nothing matches", async () => {
    const fullPage = Array.from({ length: 100 }, (_, i) => ({ plan_code: `PLN_${i}`, name: `Unrelated ${i}`, amount: 1, interval: "monthly" }));
    const shortPage = [{ plan_code: "PLN_scale", name: "Wholesale Scale", amount: PLAN_LIMITS.SCALE.monthlyFeeCents, interval: "monthly" }];
    const fetchMock = vi.fn().mockResolvedValueOnce(plansResponse(fullPage)).mockResolvedValueOnce(plansResponse(shortPage));
    vi.stubGlobal("fetch", fetchMock);

    const code = await findOrCreatePaystackPlan("SCALE");
    expect(code).toBe("PLN_scale");
    expect(fetchMock).toHaveBeenCalledTimes(2); // found on the second page, no create call needed
  });
});

describe("createPaystackSubscription", () => {
  beforeEach(() => {
    process.env.PAYSTACK_SECRET_KEY = "subs-test-secret";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("refuses when Paystack isn't configured", async () => {
    delete process.env.PAYSTACK_SECRET_KEY;
    await expect(
      createPaystackSubscription({ customerEmail: "owner@example.com", planCode: "PLN_x", authorizationCode: "AUTH_x" })
    ).rejects.toBeInstanceOf(PaystackError);
  });

  it("creates a subscription against the given plan and authorization", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: true, data: { subscription_code: "SUB_abc", status: "active" } }), { status: 200 })
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await createPaystackSubscription({ customerEmail: "owner@example.com", planCode: "PLN_x", authorizationCode: "AUTH_x" });
    expect(result).toEqual({ subscriptionCode: "SUB_abc", status: "active" });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toEqual({ customer: "owner@example.com", plan: "PLN_x", authorization: "AUTH_x" });
  });

  it("surfaces Paystack's own rejection message cleanly", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: false, message: "Authorization code not found" }), { status: 200 })));
    await expect(
      createPaystackSubscription({ customerEmail: "owner@example.com", planCode: "PLN_x", authorizationCode: "AUTH_bad" })
    ).rejects.toThrow(/Authorization code not found/);
  });
});
