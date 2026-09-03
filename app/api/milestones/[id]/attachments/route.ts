import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api";
import { getCurrentUser } from "@/lib/session";
import { recordAttachment } from "@/lib/activity";
import { MAX_UPLOAD_BYTES, isAllowedType, save } from "@/lib/uploads";
import { formatBytes } from "@/lib/utils";
import { hasAdminPower } from "@/lib/constants";

/** Upload a file against a milestone. */
export async function POST(
  request: Request,
  { params }: { params: { id: string } },
) {
  const user = await getCurrentUser();
  if (!user) return apiError("You must be signed in", 401);

  const milestone = await prisma.milestone.findUnique({
    where: { id: params.id },
    select: { id: true, title: true, assigneeId: true },
  });
  if (!milestone) return apiError("That milestone no longer exists", 404);

  if (!hasAdminPower(user.role) && milestone.assigneeId !== user.id) {
    return apiError("You can only attach files to your own milestones", 403);
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return apiError("Expected a file upload", 400);
  }

  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return apiError("Choose a file to upload", 422, { file: "No file received" });
  }

  if (file.size > MAX_UPLOAD_BYTES) {
    return apiError(
      `That file is ${formatBytes(file.size)}. The limit is ${formatBytes(MAX_UPLOAD_BYTES)}.`,
      413,
      { file: "Too large" },
    );
  }

  // The browser's declared type is all we have; the allowlist is what keeps
  // anything script-capable off the disk in the first place.
  if (!isAllowedType(file.type)) {
    return apiError(
      `${file.type || "That file type"} isn't accepted. Images, PDFs, documents and archives are.`,
      415,
      { file: "Unsupported type" },
    );
  }

  try {
    const created = await prisma.$transaction(async (tx) => {
      const row = await tx.attachment.create({
        data: {
          milestoneId: milestone.id,
          uploaderId: user.id,
          // Display only — never used to build a path.
          filename: file.name.slice(0, 200),
          storedName: "pending",
          mimeType: file.type,
          size: file.size,
        },
      });

      const storedName = await save(
        row.id,
        file.type,
        Buffer.from(await file.arrayBuffer()),
      );

      return tx.attachment.update({
        where: { id: row.id },
        data: { storedName },
        include: { uploader: { select: { id: true, name: true } } },
      });
    });

    await recordAttachment({
      milestoneId: milestone.id,
      title: milestone.title,
      actorId: user.id,
      filename: created.filename,
    });

    return NextResponse.json(
      {
        attachment: {
          id: created.id,
          filename: created.filename,
          mimeType: created.mimeType,
          size: created.size,
          createdAt: created.createdAt,
          uploader: created.uploader,
          isImage: created.mimeType.startsWith("image/"),
          url: `/api/attachments/${created.id}/raw`,
        },
      },
      { status: 201 },
    );
  } catch {
    return apiError("Couldn't store that file", 500);
  }
}
