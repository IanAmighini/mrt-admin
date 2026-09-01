"use server";

import { revalidatePath } from "next/cache";
import { Prisma, type UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth-helpers";
import { hashPassword } from "@/lib/password";

const ROLES: UserRole[] = ["ADMIN", "CARGA_DIARIA", "SOLO_LECTURA", "SECRETARIA"];

export async function createUser(formData: FormData) {
  await requireRole(["ADMIN"]);

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

  try {
    await prisma.user.create({ data: { name, email, role, passwordHash } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new Error("Ya existe un usuario con ese email.");
    }
    throw error;
  }

  revalidatePath("/usuarios");
}

export async function updateUserRole(formData: FormData) {
  await requireRole(["ADMIN"]);

  const id = String(formData.get("id") || "");
  const role = String(formData.get("role") || "") as UserRole;
  if (!id || !ROLES.includes(role)) {
    throw new Error("Datos inválidos.");
  }

  await prisma.user.update({ where: { id }, data: { role } });
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

  await prisma.user.update({ where: { id }, data: { active: !active } });
  revalidatePath("/usuarios");
}
