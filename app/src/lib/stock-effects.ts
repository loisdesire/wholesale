import { StockMovementReason } from "@prisma/client";

/**
 * How one ledger movement changes the four stock figures. Stored on each
 * StockMovement row as three explicit deltas so every figure is a plain
 * SUM() — nothing about stock is ever an editable number.
 *
 *   physical  = units on the shelf (sold-and-shipped units have left)
 *   reserved  = physical units promised to confirmed orders, not yet shipped
 *   damaged   = physical units set aside as unsellable
 *   available = physical - reserved - damaged   (what can still be promised)
 */
export type StockEffects = { physicalDelta: number; reservedDelta: number; damagedDelta: number };

export type StockFigures = { physical: number; reserved: number; damaged: number; available: number };

type Rule = {
  /** What the signed `quantityDelta` a caller passes is measured in. */
  sign: "positive" | "negative" | "either";
  effects: (q: number) => StockEffects;
};

const e = (physicalDelta: number, reservedDelta: number, damagedDelta: number): StockEffects => ({
  physicalDelta,
  reservedDelta,
  damagedDelta,
});

/**
 * `quantityDelta` is signed from the point of view of the thing the reason
 * changes: physical stock for receipts/returns/adjustments/shipping/write-offs,
 * and *available* stock for reserve / release / set-aside-as-damaged (so
 * reserving 3 units is -3, releasing them is +3).
 */
const RULES: Record<StockMovementReason, Rule> = {
  INITIAL_STOCK: { sign: "positive", effects: (q) => e(q, 0, 0) },
  PURCHASE_RECEIVED: { sign: "positive", effects: (q) => e(q, 0, 0) },
  RETURN: { sign: "positive", effects: (q) => e(q, 0, 0) }, // resellable goods back on the shelf
  RETURN_DAMAGED: { sign: "positive", effects: (q) => e(q, 0, q) }, // back on the shelf, but unsellable
  MANUAL_ADJUSTMENT: { sign: "either", effects: (q) => e(q, 0, 0) },
  SALE_RESERVED: { sign: "negative", effects: (q) => e(0, -q, 0) }, // available -> reserved
  RESERVATION_RELEASED: { sign: "positive", effects: (q) => e(0, -q, 0) }, // reserved -> available
  SALE_FULFILLED: { sign: "negative", effects: (q) => e(q, q, 0) }, // shipped: leaves physical and reserved
  DAMAGE: { sign: "negative", effects: (q) => e(0, 0, -q) }, // available -> damaged
  DAMAGE_WRITTEN_OFF: { sign: "negative", effects: (q) => e(q, 0, q) }, // damaged stock discarded
};

export function movementEffects(reason: StockMovementReason, quantityDelta: number): StockEffects {
  if (!Number.isInteger(quantityDelta) || quantityDelta === 0) {
    throw new Error("Stock movement quantity must be a non-zero whole number.");
  }
  const rule = RULES[reason];
  if (rule.sign === "positive" && quantityDelta < 0) {
    throw new Error(`${reason} movements must be positive.`);
  }
  if (rule.sign === "negative" && quantityDelta > 0) {
    throw new Error(`${reason} movements must be negative.`);
  }
  return rule.effects(quantityDelta);
}

export function toFigures(sum: { physical: number; reserved: number; damaged: number }): StockFigures {
  return { ...sum, available: sum.physical - sum.reserved - sum.damaged };
}

export const EMPTY_FIGURES: StockFigures = toFigures({ physical: 0, reserved: 0, damaged: 0 });
