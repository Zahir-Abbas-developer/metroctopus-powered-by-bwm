import type { Metadata } from "next";
import { Layers } from "lucide-react";

import { requireUser } from "@/lib/session";
import { ComingSoon } from "@/components/layout/ComingSoon";

export const metadata: Metadata = {
  title: "Projects",
};

export default async function ProjectsPage() {
  await requireUser();

  return (
    <ComingSoon
      eyebrow="Delivery"
      title="Projects"
      description="Each client's monthly engagement, broken into service modules and dated milestones."
      phase="Phase 3"
      icon={Layers}
      bullets={[
        "One project per client per retainer month",
        "Modules for each service line, with a dedicated owner",
        "Milestones with hard deadlines in Asia/Karachi time",
        "Progress visible without anyone having to ask for it",
      ]}
    />
  );
}
