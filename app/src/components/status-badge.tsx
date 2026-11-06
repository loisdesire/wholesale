import { clsx } from "clsx";

type StatusMeta = {
  label: string;
  dotColor: string;
  textColor: string;
  // Only true exceptions (Cancelled, Overdue, Critical) get a subtle wash background
  wash?: string;
};

const CONVERSATION_STATUS: Record<string, StatusMeta> = {
  NEW: { 
    label: "New", 
    dotColor: "bg-accent", 
    textColor: "text-ink font-semibold" 
  },
  AI_HANDLING: { 
    label: "AI Active", 
    dotColor: "bg-accent", 
    textColor: "text-accent font-semibold" 
  },
  AWAITING_STAFF: { 
    label: "Needs Staff", 
    dotColor: "bg-amber-600", 
    textColor: "text-amber-950 font-bold" 
  },
  RESOLVED: { 
    label: "Resolved", 
    dotColor: "bg-emerald-600", 
    textColor: "text-emerald-950 font-semibold" 
  },
};

const ORDER_STATUS: Record<string, StatusMeta> = {
  DRAFT: { 
    label: "Draft", 
    dotColor: "bg-ink/50", 
    textColor: "text-ink/80 font-semibold" 
  },
  CONFIRMED: { 
    label: "Confirmed", 
    dotColor: "bg-accent", 
    textColor: "text-accent font-semibold" 
  },
  PAID: { 
    label: "Paid", 
    dotColor: "bg-emerald-600", 
    textColor: "text-emerald-800 font-semibold" 
  },
  PARTIALLY_FULFILLED: { 
    label: "Partly Shipped", 
    dotColor: "bg-amber-600", 
    textColor: "text-amber-950 font-semibold" 
  },
  FULFILLED: { 
    label: "Fulfilled", 
    dotColor: "bg-emerald-600", 
    textColor: "text-emerald-800 font-semibold" 
  },
  CANCELLED: { 
    label: "Cancelled", 
    dotColor: "bg-status-attention-fg", 
    textColor: "text-status-attention-fg font-semibold" 
  },
};

const RETURN_STATUS: Record<string, StatusMeta> = {
  REQUESTED: { 
    label: "Pending Review", 
    dotColor: "bg-amber-600", 
    textColor: "text-amber-950 font-bold" 
  },
  APPROVED: { 
    label: "Approved", 
    dotColor: "bg-accent", 
    textColor: "text-accent font-semibold" 
  },
  REJECTED: { 
    label: "Rejected", 
    dotColor: "bg-status-attention-fg", 
    textColor: "text-status-attention-fg font-semibold" 
  },
  RECEIVED: { 
    label: "Goods Intake", 
    dotColor: "bg-emerald-600", 
    textColor: "text-emerald-800 font-semibold" 
  },
};

const REFUND_STATUS: Record<string, StatusMeta> = {
  NONE: { 
    label: "No Refund", 
    dotColor: "bg-line", 
    textColor: "text-text-muted" 
  },
  PENDING: { 
    label: "Refund Due", 
    dotColor: "bg-status-attention-fg", 
    textColor: "text-status-attention-fg font-medium",
    wash: "bg-status-attention-bg px-2 py-0.5 rounded"
  },
  REFUNDED: { 
    label: "Refunded", 
    dotColor: "bg-emerald-600", 
    textColor: "text-text-muted" 
  },
};

const SUBSCRIPTION_STATUS: Record<string, StatusMeta> = {
  TRIALING: { 
    label: "Trial Active", 
    dotColor: "bg-accent", 
    textColor: "text-ink font-medium" 
  },
  ACTIVE: { 
    label: "Active", 
    dotColor: "bg-emerald-600", 
    textColor: "text-ink font-medium" 
  },
  PAST_DUE: { 
    label: "Past Due", 
    dotColor: "bg-status-attention-fg", 
    textColor: "text-status-attention-fg font-medium",
    wash: "bg-status-attention-bg px-2 py-0.5 rounded"
  },
  CANCELED: { 
    label: "Canceled", 
    dotColor: "bg-line", 
    textColor: "text-text-muted" 
  },
};

const SEVERITY: Record<string, StatusMeta> = {
  critical: { 
    label: "Critical", 
    dotColor: "bg-status-attention-fg", 
    textColor: "text-status-attention-fg font-semibold",
    wash: "bg-status-attention-bg px-2 py-0.5 rounded"
  },
  warning: { 
    label: "Warning", 
    dotColor: "bg-gold", 
    textColor: "text-ink font-medium",
    wash: "bg-gold/10 px-2 py-0.5 rounded"
  },
  info: { 
    label: "Info", 
    dotColor: "bg-ink/30", 
    textColor: "text-text-muted" 
  },
};

function StatusPip({ meta }: { meta: StatusMeta }) {
  return (
    <span className={clsx("inline-flex items-center gap-1.5 whitespace-nowrap text-xs", meta.wash)}>
      <span className={clsx("h-1.5 w-1.5 rounded-full shrink-0", meta.dotColor)} />
      <span className={clsx("tracking-tight", meta.textColor)}>{meta.label}</span>
    </span>
  );
}

export function ConversationStatusBadge({ status }: { status: string }) {
  const meta = CONVERSATION_STATUS[status] ?? { label: status, dotColor: "bg-line", textColor: "text-text-muted" };
  return <StatusPip meta={meta} />;
}

export function OrderStatusBadge({ status }: { status: string }) {
  const meta = ORDER_STATUS[status] ?? { label: status, dotColor: "bg-line", textColor: "text-text-muted" };
  return <StatusPip meta={meta} />;
}

export function ReturnStatusBadge({ status }: { status: string }) {
  const meta = RETURN_STATUS[status] ?? { label: status, dotColor: "bg-line", textColor: "text-text-muted" };
  return <StatusPip meta={meta} />;
}

export function RefundStatusBadge({ status }: { status: string }) {
  const meta = REFUND_STATUS[status] ?? { label: status, dotColor: "bg-line", textColor: "text-text-muted" };
  return <StatusPip meta={meta} />;
}

export function SubscriptionStatusBadge({ status }: { status: string }) {
  const meta = SUBSCRIPTION_STATUS[status] ?? { label: status, dotColor: "bg-line", textColor: "text-text-muted" };
  return <StatusPip meta={meta} />;
}

export function SeverityBadge({ severity }: { severity: string }) {
  const meta = SEVERITY[severity] ?? { label: severity, dotColor: "bg-line", textColor: "text-text-muted" };
  return <StatusPip meta={meta} />;
}
