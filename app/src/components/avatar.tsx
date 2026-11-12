// Initials avatar. The colour is derived from the name, so the same customer is the same colour
// on every screen — a cheap, reliable way to recognise people in lists without photos.
const PALETTE = [
  "bg-[#e6ebff] text-[#1a35c4]",
  "bg-[#dcf6e7] text-[#08774a]",
  "bg-[#fff0d1] text-[#8f5200]",
  "bg-[#fde7e4] text-[#b3261e]",
  "bg-[#e9e4ff] text-[#5b34c9]",
  "bg-[#d9f3f7] text-[#0b6c7d]",
  "bg-[#fbe3f1] text-[#a61e6e]",
];

const SIZES = {
  xs: "h-6 w-6 text-[10px]",
  sm: "h-8 w-8 text-xs",
  md: "h-9 w-9 text-[13px]",
  lg: "h-12 w-12 text-base",
  xl: "h-16 w-16 text-xl",
};

export function initialsOf(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return ((parts[0][0] ?? "") + (parts.length > 1 ? (parts[parts.length - 1][0] ?? "") : "")).toUpperCase();
}

export function Avatar({
  name,
  size = "md",
  shape = "circle",
}: {
  name: string;
  size?: keyof typeof SIZES;
  shape?: "circle" | "square";
}) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  const tone = shape === "square" ? "bg-ink text-gold" : PALETTE[hash % PALETTE.length];
  return (
    <span
      aria-hidden="true"
      className={`flex shrink-0 select-none items-center justify-center font-semibold ${SIZES[size]} ${tone} ${
        shape === "square" ? "rounded-[10px]" : "rounded-full"
      }`}
    >
      {shape === "square" ? name.trim()[0]?.toUpperCase() : initialsOf(name)}
    </span>
  );
}
