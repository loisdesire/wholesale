import Link from "next/link";
import { Check, Plus, Send, Sparkles } from "lucide-react";
import { Avatar } from "@/components/avatar";
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
    <div className="flex flex-col gap-4">
      <Link href="/inbox" className="back-link self-start">
        ← Inbox
      </Link>

      {/* One chat window: who you're talking to on top, the thread in the middle, the reply
          tools at the bottom — the shape every messaging app has taught people to expect. */}
      <div className="card overflow-hidden">
        <header className="flex flex-col gap-3 border-b border-line p-4 sm:p-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <Avatar name={conversation.customer.name ?? conversation.customer.phone} size="lg" />
            <div className="min-w-0">
              <h1 className="truncate font-display text-2xl font-bold tracking-tight text-ink">
                {conversation.customer.name ?? "Unnamed"}
              </h1>
              <p className="flex flex-wrap items-center gap-x-2 text-sm text-text-muted">
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-wa" />
                  WhatsApp
                </span>
                <Link href={`/customers/${conversation.customerId}`} className="font-tabular underline-offset-4 hover:text-ink hover:underline">
                  {conversation.customer.phone}
                </Link>
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            <ConversationStatusBadge status={conversation.status} />
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
            {conversation.status !== "RESOLVED" && (
              <form action={markResolvedAction.bind(null, conversation.id)}>
                <button type="submit" className="btn btn-secondary btn-sm">
                  <Check size={14} strokeWidth={2.4} />
                  Mark resolved
                </button>
              </form>
            )}
          </div>
        </header>

        <div className="flex flex-wrap items-center gap-2 border-b border-line bg-surface px-4 py-2.5 sm:px-5">
          <span className="eyebrow mr-1">Orders</span>
          {conversation.orders.map((o) => (
            <Link
              key={o.id}
              href={`/orders/${o.id}`}
              className="flex items-center gap-2 rounded-full border border-line bg-surface py-1 pl-2.5 pr-1 text-sm transition-colors hover:border-line-strong hover:bg-paper"
            >
              <span className="font-mono text-xs text-ink">{o.reference}</span>
              <OrderStatusBadge status={o.status} />
            </Link>
          ))}
          <Link
            href={`/orders/new?customerId=${conversation.customerId}&conversationId=${conversation.id}`}
            className="btn btn-primary btn-sm ml-auto"
          >
            <Plus size={14} strokeWidth={2.4} />
            Create order
          </Link>
        </div>

        <div className="bg-paper/70 px-3 py-5 sm:px-6">
          {conversation.messages.length === 0 ? (
            <p className="empty">No messages yet.</p>
          ) : (
            <div className="flex flex-col gap-2.5">
              {conversation.messages.map((m) => {
                const isInbound = m.direction === "INBOUND";
                const failed = !isInbound && m.deliveryStatus === "FAILED";
                return (
                  <div key={m.id} className={`flex flex-col ${isInbound ? "items-start" : "items-end"}`}>
                    <div
                      className={`max-w-[85%] px-3.5 py-2.5 text-sm leading-relaxed shadow-card sm:max-w-lg ${
                        isInbound
                          ? "rounded-2xl rounded-bl-md bg-surface text-ink"
                          : failed
                            ? "rounded-2xl rounded-br-md bg-status-attention-fg text-white"
                            : "rounded-2xl rounded-br-md bg-ink text-white"
                      }`}
                    >
                      {!isInbound && SENDER_LABEL[m.sender] && (
                        <p className="mb-0.5 text-[11px] font-semibold text-gold">{SENDER_LABEL[m.sender]}</p>
                      )}
                      {m.attachments.length > 0 && (
                        <div className="mb-2 flex flex-col gap-2">
                          {m.attachments.map((a) => (
                            <ZoomableImage
                              key={a.id}
                              src={`/api/attachments/${a.id}`}
                              alt="Image sent by the customer"
                              className="max-h-80 max-w-full rounded-xl border border-line/50 object-contain"
                            />
                          ))}
                        </div>
                      )}
                      {!(m.attachments.length > 0 && m.body === "[image]") && (
                        <p className="whitespace-pre-wrap">{m.body}</p>
                      )}
                      {failed && m.deliveryError && <p className="mt-1 text-xs text-white/85">{m.deliveryError}</p>}
                    </div>
                    <p className="mt-1 flex items-center gap-1.5 px-1 text-[11px] text-text-muted">
                      {isInbound && SENDER_LABEL[m.sender] && <span>{SENDER_LABEL[m.sender]} ·</span>}
                      <span className="font-tabular">{formatDateTime(m.createdAt)}</span>
                      {!isInbound && m.deliveryStatus && (
                        <span className={failed ? "font-semibold text-status-attention-fg" : m.deliveryStatus === "READ" ? "font-medium text-accent" : ""}>
                          · {DELIVERY_LABEL[m.deliveryStatus]}
                        </span>
                      )}
                    </p>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-4 border-t border-line p-4 sm:p-5">
          {aiReady ? (
            <AIAssistButton conversationId={conversation.id} />
          ) : (
            <p className="flex items-start gap-2.5 rounded-xl bg-paper px-3.5 py-3 text-sm text-text-muted">
              <Sparkles size={16} className="mt-0.5 shrink-0" />
              AI product-matching isn&apos;t configured in this environment (missing OPENAI_API_KEY).
            </p>
          )}
          {whatsappReady ? (
            <ReplyForm conversationId={conversation.id} />
          ) : (
            <p className="flex items-start gap-2.5 rounded-xl bg-paper px-3.5 py-3 text-sm text-text-muted">
              <Send size={16} className="mt-0.5 shrink-0" />
              WhatsApp sending isn&apos;t configured in this environment (missing WHATSAPP_ACCESS_TOKEN /
              WHATSAPP_PHONE_NUMBER_ID) — replies can&apos;t be sent until it is.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
