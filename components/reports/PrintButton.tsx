"use client";

import { Printer } from "lucide-react";

import { Button } from "@/components/ui/Button";

/**
 * Opens the browser's print dialog, where "Save as PDF" produces the A4
 * document laid out by the print rules in globals.css.
 */
export function PrintButton() {
  return (
    <Button
      variant="secondary"
      size="sm"
      icon={<Printer className="h-3.5 w-3.5" />}
      onClick={() => window.print()}
    >
      Print or save as PDF
    </Button>
  );
}
