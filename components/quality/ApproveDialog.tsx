"use client";

import { useEffect, useState } from "react";
import { Star } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Textarea } from "@/components/ui/Textarea";
import { cn } from "@/lib/utils";

const LABELS: Record<number, string> = {
  1: "Not usable",
  2: "Needed rework",
  3: "Fine",
  4: "Good",
  5: "Outstanding",
};

/** What each rating is worth, shown so the owner rates with the stakes in view. */
const IMPACT: Record<number, string> = {
  1: "−1 point",
  2: "−1 point",
  3: "No score effect",
  4: "No score effect",
  5: "+0.5 points",
};

/**
 * Approving work now means judging it.
 *
 * Punctuality was never the whole story: work can land on time and still be
 * wrong, and a system that only measured deadlines quietly taught people that
 * getting it in was the same as getting it right.
 *
 * Two deliberate choices in the copy. The score impact is on screen while the
 * owner picks, because a rating with a hidden consequence is a trap. And 3–4
 * stars say "no score effect" plainly — most work is simply fine, and an owner
 * who thinks every rating moves a score will rate everything a 4 to avoid a
 * conversation, which makes the whole measure worthless.
 */
export function ApproveDialog({
  open,
  title,
  memberName,
  busy,
  onClose,
  onApprove,
}: {
  open: boolean;
  title: string;
  memberName: string | null;
  busy?: boolean;
  onClose: () => void;
  onApprove: (rating: number, comment: string) => void | Promise<void>;
}) {
  const [rating, setRating] = useState<number | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [comment, setComment] = useState("");

  useEffect(() => {
    if (!open) return;
    setRating(null);
    setHover(null);
    setComment("");
  }, [open]);

  const shown = hover ?? rating;
  const needsComment = rating !== null && rating <= 2;
  const blocked = rating === null || (needsComment && comment.trim().length < 5);

  return (
    <Modal open={open} onClose={onClose} title="Approve and rate">
      <div className="space-y-5">
        <div>
          <p className="text-[13px] font-medium text-ink">{title}</p>
          {memberName && (
            <p className="mt-0.5 text-[13px] text-ink/50">Delivered by {memberName}</p>
          )}
        </div>

        <div>
          <p className="mb-2 text-[13px] font-medium text-ink/80">
            How good was it?
            <span className="ml-1 text-danger">*</span>
          </p>

          <div className="flex items-center gap-1" onMouseLeave={() => setHover(null)}>
            {[1, 2, 3, 4, 5].map((value) => (
              <button
                key={value}
                type="button"
                aria-label={`${value} star${value === 1 ? "" : "s"} — ${LABELS[value]}`}
                aria-pressed={rating === value}
                onMouseEnter={() => setHover(value)}
                onFocus={() => setHover(value)}
                onClick={() => setRating(value)}
                className="rounded p-1 transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
              >
                <Star
                  className={cn(
                    "h-7 w-7 transition-colors",
                    shown !== null && value <= shown
                      ? shown <= 2
                        ? "fill-danger text-danger"
                        : shown === 5
                          ? "fill-brand text-brand"
                          : "fill-warn text-warn"
                      : "text-ink/20",
                  )}
                />
              </button>
            ))}

            {shown !== null && (
              <span className="ml-3 min-w-0">
                <span className="block text-[13px] font-medium text-ink">{LABELS[shown]}</span>
                <span
                  className={cn(
                    "block text-[12px]",
                    shown === 5 ? "text-brand" : shown <= 2 ? "text-danger" : "text-ink/45",
                  )}
                >
                  {IMPACT[shown]}
                </span>
              </span>
            )}
          </div>
        </div>

        {needsComment && (
          <Textarea
            label="What fell short"
            requiredMark
            rows={3}
            autoFocus
            value={comment}
            placeholder="The ROAS figure didn't reconcile with the ad account and the date range was wrong."
            onChange={(event) => setComment(event.target.value)}
            hint="Goes to the member with the deduction. A low rating they can't act on is just a number that makes them feel bad."
          />
        )}

        {!needsComment && rating !== null && (
          <Textarea
            label="Anything worth saying"
            rows={2}
            value={comment}
            placeholder={rating === 5 ? "Best version of this report we've sent." : "Optional."}
            onChange={(event) => setComment(event.target.value)}
          />
        )}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            loading={busy}
            disabled={blocked}
            onClick={() => rating !== null && void onApprove(rating, comment.trim())}
          >
            Approve
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/** The rating as read-only stars, for a drawer or a report. */
export function QualityStars({
  rating,
  size = 14,
  className,
}: {
  rating: number;
  size?: number;
  className?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-0.5", className)} aria-label={`${rating} of 5`}>
      {[1, 2, 3, 4, 5].map((value) => (
        <Star
          key={value}
          style={{ width: size, height: size }}
          className={
            value <= rating
              ? rating <= 2
                ? "fill-danger text-danger"
                : rating === 5
                  ? "fill-brand text-brand"
                  : "fill-warn text-warn"
              : "text-ink/15"
          }
        />
      ))}
    </span>
  );
}
