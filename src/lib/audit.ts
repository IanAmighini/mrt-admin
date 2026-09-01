import "server-only";
import type { AuditAction, Prisma } from "@prisma/client";
import { prisma } from "./prisma";

export async function logAudit(
  tx: Prisma.TransactionClient | typeof prisma,
  params: { userId: string; action: AuditAction; entityType: string; entityId?: string; summary: string }
) {
  await tx.auditLog.create({ data: params });
}
