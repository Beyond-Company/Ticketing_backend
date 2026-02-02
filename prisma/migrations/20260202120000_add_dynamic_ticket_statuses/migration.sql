-- CreateTable
CREATE TABLE "ticket_statuses" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameAr" TEXT,
    "color" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "organizationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ticket_statuses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ticket_statuses_name_organizationId_key" ON "ticket_statuses"("name", "organizationId");

-- AddForeignKey
ALTER TABLE "ticket_statuses" ADD CONSTRAINT "ticket_statuses_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable: add status_id nullable first
ALTER TABLE "tickets" ADD COLUMN "statusId" TEXT;

-- Backfill: create default statuses for each organization
INSERT INTO "ticket_statuses" ("id", "name", "nameAr", "color", "order", "organizationId", "createdAt", "updatedAt")
SELECT 
  gen_random_uuid()::text,
  v.name,
  v."nameAr",
  v.color,
  v.ord,
  o.id,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "organizations" o
CROSS JOIN (
  VALUES 
    ('Open', 'مفتوحة', '#3b82f6', 0),
    ('In Progress', 'قيد التنفيذ', '#f59e0b', 1),
    ('Resolved', 'تم الحل', '#10b981', 2),
    ('Closed', 'مغلقة', '#6b7280', 3)
) AS v(name, "nameAr", color, ord);

-- Update tickets to set statusId from enum
UPDATE "tickets" t
SET "statusId" = (
  SELECT ts.id FROM "ticket_statuses" ts 
  WHERE ts."organizationId" = t."organizationId" 
  AND ts.name = CASE t.status
    WHEN 'OPEN' THEN 'Open'
    WHEN 'IN_PROGRESS' THEN 'In Progress'
    WHEN 'RESOLVED' THEN 'Resolved'
    WHEN 'CLOSED' THEN 'Closed'
  END
  LIMIT 1
);

-- Make statusId required
ALTER TABLE "tickets" ALTER COLUMN "statusId" SET NOT NULL;

-- Drop old status column and enum
ALTER TABLE "tickets" DROP COLUMN "status";
DROP TYPE "TicketStatus";

-- AddForeignKey for statusId
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_statusId_fkey" FOREIGN KEY ("statusId") REFERENCES "ticket_statuses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
