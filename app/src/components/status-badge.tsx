type Tone = "neutral" | "progress" | "success" | "attention";

const TONE_CLASSES: Record<Tone, string> = {
  neutral: "text-status-neutral-fg bg-status-neutral-bg",
  progress: "text-status-progress-fg bg-status-progress-bg",
  success: "text-status-success-fg bg-status-success-bg",
  attention: "text-status-attention-fg bg-status-attention-bg",
};

const CONVERSATION_STATUS: Record<string, { label: string; tone: Tone }> = {
  NEW: { label: "New", tone: "neutral" },
  AI_HANDLING: { label: "AI handling", tone: "progress" },
  AWAITING_STAFF: { label: "Awaiting staff", tone: "attention" },
  RESOLVED: { label: "Resolved", tone: "success" },
};

const ORDER_STATUS: Record<string, { label: string; tone: Tone }> = {
  DRAFT: { label: "Draft", tone: "neutral" },
  CONFIRMED: { label: "Confirmed", tone: "progress" },
  PAID: { label: "Paid", tone: "success" },
  PARTIALLY_FULFILLED: { label: "Partly shipped", tone: "progress" },
  FULFILLED: { label: "Fulfilled", tone: "success" },
  CANCELLED: { label: "Cancelled", tone: "attention" },
};

const RETURN_STATUS: Record<string, { label: string; tone: Tone }> = {
  REQUESTED: { label: "Awaiting decision", tone: "attention" },
  APPROVED: { label: "Approved", tone: "progress" },
  REJECTED: { label: "Rejected", tone: "neutral" },
  RECEIVED: { label: "Goods received", tone: "success" },
};

const REFUND_STATUS: Record<string, { label: string; tone: Tone }> = {
  NONE: { label: "No refund due", tone: "neutral" },
  PENDING: { label: "Refund to pay", tone: "attention" },
  REFUNDED: { label: "Refunded", tone: "success" },
};

function Badge({ label, tone }: { label: string; tone: Tone }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${TONE_CLASSES[tone]}`}
    >
      {label}
    </span>
  );
}

export function ConversationStatusBadge({ status }: { status: string }) {
  const entry = CONVERSATION_STATUS[status] ?? { label: status, tone: "neutral" as Tone };
  return <Badge {...entry} />;
}

export function OrderStatusBadge({ status }: { status: string }) {
  const entry = ORDER_STATUS[status] ?? { label: status, tone: "neutral" as Tone };
  return <Badge {...entry} />;
}

export function ReturnStatusBadge({ status }: { status: string }) {
  const entry = RETURN_STATUS[status] ?? { label: status, tone: "neutral" as Tone };
  return <Badge {...entry} />;
}

export function RefundStatusBadge({ status }: { status: string }) {
  const entry = REFUND_STATUS[status] ?? { label: status, tone: "neutral" as Tone };
  return <Badge {...entry} />;
}
