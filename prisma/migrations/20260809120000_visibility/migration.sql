-- AlterTable
-- Gates deal values under the Production Doctrine's permission matrix. An
-- explicit flag rather than a jobTitle match: a permission that turns on
-- because free text contains "Business Developer" changes when someone edits
-- their title for cosmetic reasons.
ALTER TABLE "User" ADD COLUMN "isBusinessDev" BOOLEAN NOT NULL DEFAULT false;
