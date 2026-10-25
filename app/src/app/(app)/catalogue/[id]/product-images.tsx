"use client";

import { useActionState } from "react";
import { ZoomableImage } from "@/components/zoomable-image";
import { uploadProductImageAction, deleteProductImageAction, type ProductImageState } from "../actions";

function DeleteImageButton({ productId, imageId }: { productId: string; imageId: string }) {
  // A plain onClick calling a server action directly doesn't refresh the page after
  // revalidatePath() the way a <form action> submission does — useActionState is what wires
  // this delete up to actually re-render once the server confirms it, same as every other
  // single-click action in this app (e.g. returns-ui.tsx's ReceiveGoodsButton).
  const [, formAction, pending] = useActionState<ProductImageState, FormData>(
    () => deleteProductImageAction(productId, imageId),
    { error: null }
  );
  return (
    <form action={formAction}>
      <button
        type="submit"
        disabled={pending}
        aria-label="Delete photo"
        className="absolute right-1 top-1 rounded-full bg-ink/70 px-1.5 py-0.5 text-xs text-paper opacity-0 transition-opacity hover:bg-status-attention-fg group-hover:opacity-100 disabled:opacity-100"
      >
        {pending ? "…" : "✕"}
      </button>
    </form>
  );
}

export function ProductImages({ productId, images }: { productId: string; images: { id: string }[] }) {
  const [state, formAction, pending] = useActionState<ProductImageState, FormData>(
    uploadProductImageAction.bind(null, productId),
    { error: null }
  );

  return (
    <div className="flex flex-col gap-4">
      {images.length === 0 ? (
        <p className="rounded-md border border-dashed border-line px-4 py-6 text-center text-sm text-text-muted">
          No photos yet.
        </p>
      ) : (
        <div className="flex flex-wrap gap-3">
          {images.map((img) => (
            <div key={img.id} className="group relative">
              <ZoomableImage
                src={`/api/product-images/${img.id}`}
                alt="Product photo"
                className="h-28 w-28 rounded-md border border-line object-cover"
              />
              <DeleteImageButton productId={productId} imageId={img.id} />
            </div>
          ))}
        </div>
      )}

      <form action={formAction} className="flex flex-wrap items-center gap-3">
        <input
          type="file"
          name="file"
          accept="image/*"
          required
          className="text-sm text-text-muted file:mr-3 file:rounded-md file:border file:border-line file:bg-surface file:px-3 file:py-1.5 file:text-sm file:text-ink"
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded-md border border-line px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-paper disabled:opacity-60"
        >
          {pending ? "Uploading…" : "Add photo"}
        </button>
        {state.error && <p className="text-sm text-status-attention-fg">{state.error}</p>}
      </form>
    </div>
  );
}
