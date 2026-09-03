import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api";
import { getCurrentUser } from "@/lib/session";
import { read } from "@/lib/uploads";
import { hasAdminPower } from "@/lib/constants";

/**
 * Serves an uploaded file.
 *
 * Deliberately a route handler rather than static hosting out of /public:
 * every read is authenticated and scoped, the content type is echoed from the
 * allowlisted value recorded at upload, and `nosniff` plus an attachment
 * disposition stop the browser from ever executing what it receives in this
 * origin.
 */
export async function GET(
  _request: Request,
  { params }: { params: { id: string } },
) {
  const user = await getCurrentUser();
  if (!user) return apiError("You must be signed in", 401);

  const attachment = await prisma.attachment.findUnique({
    where: { id: params.id },
    include: { milestone: { select: { assigneeId: true } } },
  });
  if (!attachment) return apiError("That file no longer exists", 404);

  if (!hasAdminPower(user.role) && attachment.milestone.assigneeId !== user.id) {
    return apiError("That file isn't yours to open", 403);
  }

  const bytes = await read(attachment.storedName);
  if (!bytes) return apiError("That file is missing from storage", 404);

  const isImage = attachment.mimeType.startsWith("image/");

  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": attachment.mimeType,
      "Content-Length": String(bytes.length),
      // Images render inline as thumbnails; everything else downloads.
      "Content-Disposition": `${isImage ? "inline" : "attachment"}; filename="${sanitise(attachment.filename)}"`,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; img-src 'self'; sandbox",
      "Cache-Control": "private, max-age=3600",
    },
  });
}

/** Strips anything that would break out of the header's quoted string. */
function sanitise(filename: string): string {
  return filename.replace(/["\\\r\n]/g, "_");
}
