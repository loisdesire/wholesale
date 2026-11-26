import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { searchCustomersForPicker } from "@/lib/customer-picker";

// Typeahead for the order form. Signed-in users only; always scoped to their own business.
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const q = req.nextUrl.searchParams.get("q") ?? "";
  const customers = await searchCustomersForPicker(session.user.organizationId, q);
  return NextResponse.json({ customers }, { headers: { "Cache-Control": "no-store" } });
}
