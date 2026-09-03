import type { Metadata } from "next";

import { requireUser } from "@/lib/session";
import { getSettings } from "@/lib/settings";
import { Card } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";
import { RATES, EARLY_BONUS_POINTS, MONTHLY_BASELINE } from "@/lib/scoring";
import { moduleGate } from "@/lib/module-guard";

export const metadata: Metadata = { title: "How scoring works" };

/**
 * The rules, generated from the live Settings row.
 *
 * Nothing here is hard-coded prose about a number. Every figure is read from
 * the same settings the engines read, so the page cannot drift from the
 * behaviour — which is the entire point: rules that live in someone's memory
 * are folklore, and folklore is what people argue about.
 */
export default async function ScoringPage() {
  // Parked module: the nav entry is already gone, so this guards a
  // bookmark or a typed URL rather than a link.
  const gate = await moduleGate("scoring");
  if (gate) return gate;

  await requireUser();
  const settings = await getSettings();

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="No folklore"
        title="How scoring &amp; incentives work"
        description="Every number on this page is read live from the agency's settings, so it always describes what the system actually does."
      />

      <Section
        title="The month"
        lead={`Everyone starts each calendar month at ${MONTHLY_BASELINE} points. Your score is ${MONTHLY_BASELINE} plus everything that happened, clamped to 0–100. Nothing is stored — the score is always the sum of its events, which is why it can never disagree with its own history.`}
      />

      <Section title="Delivery">
        <Rule
          name="Late"
          amount={`weight × ${RATES.LATE_BASE}, plus ${RATES.LATE_PER_EXTRA_DAY} × weight per extra day, capped at weight × ${RATES.LATE_CAP}`}
          detail="Judged on when you submitted, never on when it was approved. How long a review takes is the reviewer's metric, not yours."
        />
        <Rule
          name="Delivered early"
          amount={`+${EARLY_BONUS_POINTS}`}
          detail="Submitted a full day or more before the deadline."
        />
        <Rule
          name="Missed"
          amount={`weight × ${RATES.MISSED}`}
          detail="Only for work never handed in at all when the cycle closes. Anything submitted and waiting on a review is not missed."
        />
        <Rule
          name="Sent back for rework"
          amount={`weight × ${RATES.REJECTED}`}
          detail="Charged each time, and always with a written reason."
        />
        <Rule
          name="Blocked"
          amount="no charge"
          detail="Time waiting on a client or a third party is added to your deadline. You are never charged for time you couldn't act in."
        />
      </Section>

      <Section title="Quality">
        <Rule
          name="Five stars"
          amount={`+${settings.bonusQualityHigh}`}
          detail="Outstanding work, judged at approval."
        />
        <Rule name="Three or four stars" amount="no effect" detail="Most work is simply fine." />
        <Rule
          name="One or two stars"
          amount={`−${settings.penaltyQualityLow}`}
          detail="Always with a written explanation — a low rating you can't act on isn't feedback."
        />
      </Section>

      <Section title="Being reachable">
        <Rule
          name="Late start"
          amount={`−${settings.penaltyLateClockIn}`}
          detail={`Clocking in more than ${settings.graceMinutes} minutes after the shift starts.`}
        />
        <Rule
          name="Absent"
          amount={`−${settings.penaltyAbsentDay}`}
          detail="No clock-in and no approved leave."
        />
        <Rule
          name="Missed availability check"
          amount={`−${settings.penaltyMissedCheck}`}
          detail={`${settings.checksPerDay} random checks a day, each with a ${settings.checkWindowMinutes}-minute window.`}
        />
        <Rule
          name="Breaks and outages"
          amount="no charge"
          detail={`${settings.breakAllowanceMinutes} protected minutes a day for prayer and meals, and up to ${settings.outageReportsPerMonth} declared outages a month.`}
        />
      </Section>

      <Section title="Business development">
        <Rule name="Deal won" amount={`+${settings.bonusDealWon}`} detail="Credited to whoever owns the lead." />
        <Rule
          name="Weekly target met"
          amount={`+${settings.bonusTargetMet}`}
          detail="One point per target, settled on Monday for the week just finished."
        />
        <Rule
          name="Weekly target missed"
          amount={`−${settings.penaltyTargetMissed}`}
          detail={`Only below ${Math.round(settings.targetMissThreshold * 100)}% of the number. A near miss after a real week costs nothing.`}
        />
      </Section>

      <Section
        title="Incentives"
        lead="Two rules, evaluated automatically when a month closes."
      >
        <Rule
          name="Excellence bonus"
          amount={`${settings.bonusStreakMonths} months at ${settings.bonusThresholdScore}+`}
          detail={`Consecutive months. Earns a badge and a place on the owner's bonus list — the standing reference is ${settings.defaultBonusPercent}%. Months you weren't here for are skipped, not counted against you.`}
        />
        <Rule
          name="Performance review"
          amount={`${settings.reviewTriggerCount} of the last ${settings.reviewWindowMonths} months below ${settings.reviewThresholdScore}`}
          detail="Raises a flag to the owner with the evidence attached — the score events, the attendance, any disputes. It's a conversation, not an automatic consequence."
        />
      </Section>

      <Section
        title="If you disagree"
        lead={`Any deduction can be formally disputed within ${settings.disputeWindowDays} days, from your performance page. You write your case; the owner or your service lead answers within ${settings.disputeSlaHours} hours, in writing, either way.`}
      >
        <Rule
          name="If it's upheld"
          amount="nothing changes"
          detail="You get the reasoning in writing, and the fact that you asked is permanent."
        />
        <Rule
          name="If it's reversed"
          amount="points returned"
          detail="A compensating adjustment is written beside the original. The original stays — the record shows both what happened and that it was corrected."
        />
      </Section>

      <Card>
        <h2 className="font-display text-base font-bold tracking-tight text-ink">
          Two things the system will never do
        </h2>
        <ul className="mt-3 space-y-2.5 text-[13px] leading-relaxed text-ink/60">
          <li>
            <strong className="font-medium text-ink">Delete a score event.</strong> Corrections are
            written beside the original, never over it. A ledger that can be edited to make an
            argument go away is not evidence.
          </li>
          <li>
            <strong className="font-medium text-ink">
              Let anyone approve or excuse their own work.
            </strong>{" "}
            Service leads carry the owner&rsquo;s authority inside their own service lines and
            nowhere else, and never over themselves.
          </li>
        </ul>
      </Card>
    </div>
  );
}

function Section({
  title,
  lead,
  children,
}: {
  title: string;
  lead?: string;
  children?: React.ReactNode;
}) {
  return (
    <Card>
      <h2 className="font-display text-base font-bold tracking-tight text-ink">{title}</h2>
      {lead && <p className="mt-2 text-[13px] leading-relaxed text-ink/60">{lead}</p>}
      {children && <dl className="mt-4 divide-y divide-line">{children}</dl>}
    </Card>
  );
}

function Rule({ name, amount, detail }: { name: string; amount: string; detail: string }) {
  return (
    <div className="py-3.5 first:pt-0 last:pb-0">
      <dt className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-[13px] font-medium text-ink">{name}</span>
        <span className="font-display text-[13px] font-bold tabular-nums text-ink/70">
          {amount}
        </span>
      </dt>
      <dd className="mt-1 text-[13px] leading-relaxed text-ink/55">{detail}</dd>
    </div>
  );
}
