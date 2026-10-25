import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { tenantDb } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { ConversationStatusBadge, OrderStatusBadge } from "@/components/status-badge";
import { isWhatsAppConfigured } from "@/lib/whatsapp";
import { isAIConfigured } from "@/lib/ai/engine";
import { listOrganizationMembers } from "@/lib/membership";
import { AssigneeControl } from "@/components/assignee-control";
import { ZoomableImage } from "@/components/zoomable-image";
import { markResolvedAction } from "../actions";
import { ReplyForm } from "./reply-form";
import { AIAssistButton } from "./ai-assist-button";

const SENDER_LABEL: Record<string, string> = {
  CUSTOMER: "",
  AI: "AI",
  STAFF: "Staff",
};

const DELIVERY_LABEL: Record<string, string> = {
  SENT: "Sent",
  DELIVERED: "Delivered",
  READ: "Read",
  FAILED: "Not delivered",
};

export default async function ConversationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  const organizationId = session!.user.organizationId;
  const db = tenantDb(organizationId);

  const conversation = await db.conversation.findFirst({
    where: { id, organizationId },
    include: {
      customer: true,
      assignedTo: true,
      messages: { orderBy: { createdAt: "asc" }, include: { attachments: { select: { id: true, mimeType: true } } } },
      orders: true,
    },
  });
  if (!conversation) notFound();

  const whatsappReady = isWhatsAppConfigured();
  const aiReady = isAIConfigured();
  const members = await listOrganizationMembers(organizationId);
  const isOwner = session!.user.role === "OWNER";

  return (
    <div className="flex flex-col gap-8">
      <header>
        <Link href="/inbox" className="text-sm text-text-muted hover:text-ink">
          ← Inbox
        </Link>
        <div className="mt-2 flex items-start justify-between">
          <div>
            <h1 className="text-xl font-medium text-ink">
              {conversation.customer.name ?? "Unnamed"}
            </h1>
            <p className="mt-1 font-tabular text-sm text-text-muted">{conversation.customer.phone}</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 text-xs text-text-muted">
              Assigned to
              <AssigneeControl
                kind="conversation"
                id={conversation.id}
                currentAssigneeId={conversation.assignedToId}
                members={members}
                isOwner={isOwner}
                currentUserId={session!.user.id}
              />
            </div>
            <ConversationStatusBadge status={conversation.status} />
            {conversation.status !== "RESOLVED" && (
              <form action={markResolvedAction.bind(null, conversation.id)}>
                <button
                  type="submit"
                  className="rounded-md border border-line px-3 py-1.5 text-xs font-medium text-ink transition-colors hover:bg-paper"
                >
                  Mark resolved
                </button>
              </form>
            )}
          </div>
        </div>
      </header>

      {conversation.orders.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-medium text-ink">Linked orders</h2>
          <div className="flex flex-wrap gap-2">
            {conversation.orders.map((o) => (
              <Link
                key={o.id}
                href={`/orders/${o.id}`}
                className="flex items-center gap-2 rounded-md border border-line bg-surface px-3 py-1.5 text-sm hover:bg-paper"
              >
                <span className="font-tabular text-ink">{o.reference}</span>
                <OrderStatusBadge status={o.status} />
              </Link>
            ))}
          </div>
        </section>
      )}

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-medium text-ink">Conversation</h2>
          <Link
            href={`/orders/new?customerId=${conversation.customerId}&conversationId=${conversation.id}`}
            className="text-sm text-ink underline underline-offset-2 hover:text-ink-2"
          >
            Create order for this customer
          </Link>
        </div>

        {conversation.messages.length === 0 ? (
          <p className="rounded-md border border-dashed border-line px-4 py-6 text-center text-sm text-text-muted">
            No messages yet.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {conversation.messages.map((m) => {
              const isInbound = m.direction === "INBOUND";
              return (
                <div key={m.id} className={`flex ${isInbound ? "justify-start" : "justify-end"}`}>
                  <div
                    className={`max-w-lg rounded-md border px-4 py-2.5 text-sm ${
                      isInbound
                        ? "border-line bg-surface text-ink"
                        : "border-ink/10 bg-ink text-paper"
                    }`}
                  >
                    <div
                      className={`mb-1 flex items-center gap-2 text-xs ${
                        isInbound ? "text-text-muted" : "text-white/60"
                      }`}
                    >
                      {SENDER_LABEL[m.sender] && <span>{SENDER_LABEL[m.sender]}</span>}
                      <span className="font-tabular">{formatDateTime(m.createdAt)}</span>
                      {!isInbound && m.deliveryStatus && (
                        <span className={m.deliveryStatus === "FAILED" ? "font-medium text-white" : ""}>
                          · {DELIVERY_LABEL[m.deliveryStatus]}
                        </span>
                      )}
                    </div>
                    {m.attachments.length > 0 && (
                      <div className="mb-2 flex flex-col gap-2">
                        {m.attachments.map((a) => (
                          <ZoomableImage
                            key={a.id}
                            src={`/api/attachments/${a.id}`}
                            alt="Image sent by the customer"
                            className="max-h-80 max-w-full rounded-md border border-line/50 object-contain"
                          />
                        ))}
                      </div>
                    )}
                    {!(m.attachments.length > 0 && m.body === "[image]") && (
                      <p className="whitespace-pre-wrap">{m.body}</p>
                    )}
                    {!isInbound && m.deliveryStatus === "FAILED" && m.deliveryError && (
                      <p className="mt-1 text-xs text-white/80">{m.deliveryError}</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-sm font-medium text-ink">AI assist</h2>
        {aiReady ? (
          <AIAssistButton conversationId={conversation.id} />
        ) : (
          <p className="rounded-md border border-dashed border-line px-4 py-4 text-sm text-text-muted">
            AI product-matching isn&apos;t configured in this environment (missing
            OPENAI_API_KEY).
          </p>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-sm font-medium text-ink">Reply</h2>
        {whatsappReady ? (
          <ReplyForm conversationId={conversation.id} />
        ) : (
          <p className="rounded-md border border-dashed border-line px-4 py-4 text-sm text-text-muted">
            WhatsApp sending isn&apos;t configured in this environment (missing
            WHATSAPP_ACCESS_TOKEN / WHATSAPP_PHONE_NUMBER_ID) — replies can&apos;t be sent until
            it is.
          </p>
        )}
      </section>
    </div>
  );
}
