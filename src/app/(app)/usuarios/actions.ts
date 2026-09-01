"use server";

import { revalidatePath } from "next/cache";
import { Prisma, type UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth-helpers";
import { hashPassword } from "@/lib/password";
import { logAudit } from "@/lib/audit";

const ROLES: UserRole[] = ["ADMIN", "SOLO_LECTURA", "SECRETARIA"];

export async function createUser(formData: FormData) {
  const admin = await requireRole(["ADMIN"]);

  const name = String(formData.get("name") || "").trim();
  const email = String(formData.get("email") || "")
    .trim()
    .toLowerCase();
  const password = String(formData.get("password") || "");
  const role = String(formData.get("role") || "") as UserRole;

  if (!name || !email || !password) {
    throw new Error("Faltan datos obligatorios.");
  }
  if (password.length < 8) {
    throw new Error("La contraseña debe tener al menos 8 caracteres.");
  }
  if (!ROLES.includes(role)) {
    throw new Error("Rol inválido.");
  }

  const passwordHash = await hashPassword(password);

  let created;
  try {
    created = await prisma.user.create({ data: { name, email, role, passwordHash } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new Error("Ya existe un usuario con ese email.");
    }
    throw error;
  }

  await logAudit(prisma, {
    userId: admin.id,
    action: "CREATE",
    entityType: "Usuario",
    entityId: created.id,
    summary: `${name} (${email})`,
  });

  revalidatePath("/usuarios");
}

export async function updateUser(formData: FormData) {
  const admin = await requireRole(["ADMIN"]);

  const id = String(formData.get("id") || "");
  const name = String(formData.get("name") || "").trim();
  const email = String(formData.get("email") || "")
    .trim()
    .toLowerCase();
  const role = String(formData.get("role") || "") as UserRole;

  if (!id || !name || !email) {
    throw new Error("Faltan datos obligatorios.");
  }
  if (!ROLES.includes(role)) {
    throw new Error("Rol inválido.");
  }

  try {
    await prisma.user.update({ where: { id }, data: { name, email, role } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new Error("Ya existe un usuario con ese email.");
    }
    throw error;
  }

  await logAudit(prisma, {
    userId: admin.id,
    action: "UPDATE",
    entityType: "Usuario",
    entityId: id,
    summary: `${name} (${email})`,
  });

  revalidatePath("/usuarios");
}

export async function toggleUserActive(formData: FormData) {
  const admin = await requireRole(["ADMIN"]);

  const id = String(formData.get("id") || "");
  const active = formData.get("active") === "true";
  if (!id) {
    throw new Error("Falta el usuario.");
  }
  if (id === admin.id) {
    throw new Error("No podés desactivar tu propio usuario.");
  }

  const target = await prisma.user.update({ where: { id }, data: { active: !active } });

  await logAudit(prisma, {
    userId: admin.id,
    action: "UPDATE",
    entityType: "Usuario",
    entityId: id,
    summary: `${target.name} — ${active ? "eliminado (desactivado)" : "reactivado"}`,
  });

  revalidatePath("/usuarios");
}
