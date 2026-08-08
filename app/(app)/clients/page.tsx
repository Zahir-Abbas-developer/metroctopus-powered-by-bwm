import type { Metadata } from "next";

import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/session";
import { ClientsBrowser } from "@/components/clients/ClientsBrowser";

export const metadata: Metadata = {
  title: "Clients",
};

export default async function ClientsPage() {
  await requireAdmin();

  // The catalogue is small and rarely changes, so it ships with the page
  // rather than costing the wizard an extra request when it opens. Retired
  // services come along too — the catalogue manager needs to show them so they
  // can be restored.
  const catalog = await prisma.serviceCatalog.findMany({
    orderBy: { order: "asc" },
    select: {
      id: true,
      name: true,
      slug: true,
      description: true,
      isActive: true,
    },
  });

  return (
    <ClientsBrowser
      catalog={catalog}
      services={catalog.filter((service) => service.isActive)}
    />
  );
}
