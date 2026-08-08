import type { Metadata } from "next";
import { Briefcase } from "lucide-react";

import { requireAdmin } from "@/lib/session";
import { ComingSoon } from "@/components/layout/ComingSoon";

export const metadata: Metadata = {
  title: "Clients",
};

export default async function ClientsPage() {
  await requireAdmin();

  return (
    <ComingSoon
      eyebrow="Delivery"
      title="Clients"
      description="Every e-commerce account on a monthly retainer, and the services each one has bought."
      phase="Phase 2"
      icon={Briefcase}
      bullets={[
        "Onboard a client with the services they've signed up for",
        "Shopify, Google Ads, Meta Ads, creative and funnel management",
        "Retainer value, start date and account status",
        "A per-client view of every module, milestone and task",
      ]}
    />
  );
}
