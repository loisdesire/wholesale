import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { tenantDb } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { ConversationStatusBadge, OrderStatusBadge } from "@/components/status-badge";
import { isWhatsAppConfigured } from "@/lib/whatsapp";
import { isTelegramConfigured } from "@/lib/telegram";
import { isAIConfigured } from "@/lib/ai/engine";
import { listOrganizationMembers } from "@/lib/membership";
import { AssigneeControl } from "@/components/assignee-control";
import { ZoomableImage } from "@/components/zoomable-image";
import { markResolvedAction } from "../actions";
import { ReplyForm } from "./reply-form";
import { AIAssistButton } from "./ai-assist-button";
import {
  ArrowLeft,
  CheckCircle2,
  Plus,
  Phone,
  Check,
  CheckCheck,
  AlertCircle,
  MessageSquare,
} from "lucide-react";

const SENDER_LABEL: Record<string, string> = {
  CUSTOMER: "Customer",
  AI: "AI Copilot",
  STAFF: "Sales Staff",
};

export default async function ConversationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  const organizationId = session!.user.organizationId;
  const db = tenantDb(organizationId);

  const conversation = await db.conversation.findFirst({
    where: { id, organizationId },
    include: {
      customer: { include: { addresses: true } },
      assignedTo: true,
      messages: { orderBy: { createdAt: "asc" }, include: { attachments: { select: { id: true, mimeType: true } } } },
      orders: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!conversation) notFound();

  const isTelegram = conversation.channel === "TELEGRAM";
  const channelReady = isTelegram ? isTelegramConfigured() : isWhatsAppConfigured();
  const aiReady = isAIConfigured();
  const members = await listOrganizationMembers(organizationId);
  const isOwner = session!.user.role === "OWNER";

  return (
    <div className="flex flex-col gap-6 pb-14">
      {/* Top Header & Context */}
      <header className="card-base flex flex-col gap-4 p-4 sm:p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Link
            href="/inbox"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-line bg-paper/60 text-ink hover:bg-paper transition-colors active:scale-95"
            title="Return to Inbox"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-display text-xl font-bold tracking-tight text-ink sm:text-2xl truncate">
                {conversation.customer.name ?? "Unnamed Customer"}
              </h1>
              <ConversationStatusBadge status={conversation.status} />
              <span className="font-tabular text-xs text-text-muted">
                {isTelegram ? "Telegram" : "WhatsApp"}
              </span>
            </div>
            <p className="mt-0.5 font-tabular text-xs text-text-muted flex items-center gap-1.5">
              <Phone className="h-3 w-3 text-text-muted/70" />
              <span>{conversation.customer.phone}</span>
            </p>
          </div>
        </div>

        {/* Header Actions */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2 rounded-xl border border-line bg-paper/40 px-3 py-1.5 text-xs text-text-muted min-h-[40px]">
            <span className="font-semibold text-ink">Assigned:</span>
            <AssigneeControl
              kind="conversation"
              id={conversation.id}
              currentAssigneeId={conversation.assignedToId}
              members={members}
              isOwner={isOwner}
              currentUserId={session!.user.id}
            />
          </div>

          <Link
            href={`/orders/new?customerId=${conversation.customerId}&conversationId=${conversation.id}`}
            className="inline-flex min-h-[40px] items-center gap-1.5 bg-accent px-3.5 py-2 text-xs font-semibold text-white transition-colors hover:bg-accent-2 cursor-pointer"
          >
            <Plus className="h-3.5 w-3.5 stroke-[2.5]" />
            <span>Create order</span>
          </Link>

          {conversation.status !== "RESOLVED" && (
            <form action={markResolvedAction.bind(null, conversation.id)}>
              <button
                type="submit"
                className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50/60 px-3.5 py-2 text-xs font-semibold text-emerald-800 transition-colors hover:bg-emerald-100 active:scale-95 cursor-pointer"
              >
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                <span>Mark resolved</span>
              </button>
            </form>
          )}
        </div>
      </header>

      {/* Linked Orders Ribbon */}
      {conversation.orders.length > 0 && (
        <div className="card-base flex flex-wrap items-center gap-3 px-5 py-3">
          <span className="text-xs text-text-muted">
            Commercial orders ({conversation.orders.length}):
          </span>
          <div className="flex flex-wrap gap-2">
            {conversation.orders.map((o) => (
              <Link
                key={o.id}
                href={`/orders/${o.id}`}
                className="inline-flex items-center gap-2 rounded-xl border border-line bg-paper/60 px-3 py-1 text-xs font-medium text-ink transition-colors hover:border-accent hover:text-accent"
              >
                <span className="font-mono font-bold">{o.reference}</span>
                <OrderStatusBadge status={o.status} />
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Main 2-Column Responsive Workspace */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left 2 Cols: Message Feed & Chat Viewport */}
        <div className="lg:col-span-2 space-y-4">
          <div className="card-base flex flex-col p-4 sm:p-6 min-h-[360px] sm:min-h-[480px] max-h-[60vh] sm:max-h-[660px] overflow-y-auto">
            {conversation.messages.length === 0 ? (
              <div className="m-auto flex flex-col items-center justify-center p-8 text-center text-text-muted">
                <MessageSquare className="h-8 w-8 text-line" />
                <p className="mt-2 text-sm font-medium">No messages recorded in this stream yet.</p>
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                {conversation.messages.map((m) => {
                  const isInbound = m.direction === "INBOUND";
                  const isAi = m.sender === "AI";

                  return (
                    <div
                      key={m.id}
                      className={`flex flex-col ${isInbound ? "items-start" : "items-end"}`}
                    >
                      <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-text-muted px-1">
                        <span className={isAi ? "text-amber-700 font-semibold" : ""}>
                          {SENDER_LABEL[m.sender] ?? (isInbound ? "Customer" : "Staff")}
                        </span>
                        <span>·</span>
                        <span className="font-tabular">{formatDateTime(m.createdAt)}</span>
                      </div>

                      <div
                        className={`max-w-md rounded-2xl px-4 py-3 text-sm shadow-xs ${
                          isInbound
                            ? "rounded-tl-xs border border-line/80 bg-paper/70 text-ink"
                            : isAi
                              ? "rounded-tr-xs border border-gold/40 bg-ink text-paper"
                              : "rounded-tr-xs bg-ink text-paper"
                        }`}
                      >
                        {m.attachments.length > 0 && (
                          <div className="mb-2.5 flex flex-col gap-2">
                            {m.attachments.map((a) => (
                              <ZoomableImage
                                key={a.id}
                                src={`/api/attachments/${a.id}`}
                                alt="Attachment sent via WhatsApp"
                                className="max-h-72 max-w-full rounded-xl border border-line/40 object-contain"
                              />
                            ))}
                          </div>
                        )}

                        {!(m.attachments.length > 0 && m.body === "[image]") && (
                          <p className="whitespace-pre-wrap leading-relaxed">{m.body}</p>
                        )}

                        {!isInbound && (
                          <div className="mt-1.5 flex items-center justify-end gap-1 text-xs text-paper/80 font-medium">
                            {m.deliveryStatus === "READ" ? (
                              <span className="flex items-center gap-1 text-sky-400 font-medium">
                                <CheckCheck className="h-3 w-3" />
                                <span>Read</span>
                              </span>
                            ) : m.deliveryStatus === "DELIVERED" ? (
                              <span className="flex items-center gap-1">
                                <CheckCheck className="h-3 w-3" />
                                <span>Delivered</span>
                              </span>
                            ) : m.deliveryStatus === "SENT" ? (
                              <span className="flex items-center gap-1">
                                <Check className="h-3 w-3" />
                                <span>Sent</span>
                              </span>
                            ) : m.deliveryStatus === "FAILED" ? (
                              <span className="flex items-center gap-1 text-rose-400 font-medium">
                                <AlertCircle className="h-3 w-3" />
                                <span>{m.deliveryError || "Failed"}</span>
                              </span>
                            ) : null}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Quick Reply Form Dock */}
          <div className="space-y-2">
            {channelReady ? (
              <ReplyForm conversationId={conversation.id} channel={conversation.channel} />
            ) : (
              <div className="rounded-2xl border border-dashed border-line bg-paper/30 p-4 text-center text-xs text-text-muted">
                {isTelegram ? "Telegram bot token" : "WhatsApp credentials"} not connected in this environment — replies can be previewed or logged.
              </div>
            )}
          </div>
        </div>

        {/* Right 1 Col: AI Copilot & Customer Card */}
        <div className="space-y-6">
          {/* AI Copilot Card */}
          <div className="card-base p-5 space-y-3.5">
            <div className="border-b border-line/60 pb-2.5">
              <h3 className="font-display text-sm font-bold text-ink">Commercial copilot</h3>
              <p className="text-xs text-text-muted">Analyze messages against active catalogue stock to prepare quote replies.</p>
            </div>

            {aiReady ? (
              <AIAssistButton conversationId={conversation.id} />
            ) : (
              <div className="rounded-xl border border-dashed border-line p-3 text-center text-xs text-text-muted">
                Anthropic AI model configured and will activate when API key is provided.
              </div>
            )}
          </div>

          {/* Customer Profile Summary */}
          <div className="card-base p-5 space-y-3.5">
            <div className="flex items-center justify-between border-b border-line/60 pb-2.5">
              <h3 className="font-display text-sm font-bold text-ink">Customer account</h3>
              <Link
                href={`/customers/${conversation.customerId}`}
                className="text-xs font-semibold text-accent hover:underline"
              >
                Full ledger
              </Link>
            </div>

            <div className="space-y-2.5 text-xs">
              <div className="flex justify-between items-baseline">
                <span className="text-text-muted">Name</span>
                <span className="font-semibold text-ink">{conversation.customer.name ?? "Unnamed"}</span>
              </div>
              <div className="flex justify-between items-baseline">
                <span className="text-text-muted">Phone</span>
                <span className="font-tabular font-medium text-ink">{conversation.customer.phone}</span>
              </div>
              <div className="flex justify-between items-baseline">
                <span className="text-text-muted">Associated orders</span>
                <span className="font-tabular font-bold text-ink">{conversation.orders.length}</span>
              </div>
              {conversation.customer.addresses.length > 0 && (
                <div className="border-t border-line/60 pt-2 text-xs text-text-muted">
                  <span className="font-semibold text-ink">Primary address:</span>
                  <p className="mt-0.5 line-clamp-2">{conversation.customer.addresses[0].text}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
