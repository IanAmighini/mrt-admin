"use server";

import { UserError } from "@/lib/user-error";
import { revalidatePath } from "next/cache";
import { Prisma, type UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth-helpers";
import { hashPassword } from "@/lib/password";
import { diffDeCampos, logAudit } from "@/lib/audit";
import { ASSIGNABLE_ROLES, ROLE_LABELS } from "@/lib/nav";
import { limpiarIntentos } from "@/lib/intentos-login";

// Misma lista que ofrecen los desplegables: un rol nuevo se agrega en un solo lugar.
const ROLES: UserRole[] = ASSIGNABLE_ROLES;

/** Lo que se mira de un usuario en el detalle de Actividad. La contraseña, obviamente, no. */
const CAMPOS_DEL_USUARIO = { name: "Nombre", email: "Email", rol: "Rol" } as const;

export async function createUser(formData: FormData) {
  const admin = await requireRole(["ADMIN"]);

  const name = String(formData.get("name") || "").trim();
  const email = String(formData.get("email") || "")
    .trim()
    .toLowerCase();
  const password = String(formData.get("password") || "");
  const role = String(formData.get("role") || "") as UserRole;

  if (!name || !email || !password) {
    throw new UserError("Faltan datos obligatorios.");
  }
  if (password.length < 8) {
    throw new UserError("La contraseña debe tener al menos 8 caracteres.");
  }
  if (!ROLES.includes(role)) {
    throw new UserError("Rol inválido.");
  }

  const passwordHash = await hashPassword(password);

  let created;
  try {
    created = await prisma.user.create({ data: { name, email, role, passwordHash } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new UserError("Ya existe un usuario con ese email.");
    }
    throw error;
  }

  await logAudit(prisma, {
    userId: admin.id,
    action: "CREATE",
    entityType: "Usuario",
    entityId: created.id,
    summary: `${name} (${email})`,
    cambios: diffDeCampos(null, { name, email, rol: ROLE_LABELS[role] }, CAMPOS_DEL_USUARIO),
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
  // Opcional: para cuando alguien se olvidó la suya. Vacío deja la que tiene.
  const nuevaContrasena = String(formData.get("password") || "");

  if (!id || !name || !email) {
    throw new UserError("Faltan datos obligatorios.");
  }
  if (!ROLES.includes(role)) {
    throw new UserError("Rol inválido.");
  }

  if (nuevaContrasena && nuevaContrasena.length < 8) {
    throw new UserError("La contraseña debe tener al menos 8 caracteres.");
  }

  const antes = await prisma.user.findUnique({ where: { id } });
  if (!antes) throw new UserError("El usuario ya no existe.");

  try {
    await prisma.user.update({
      where: { id },
      data: { name, email, role, ...(nuevaContrasena ? { passwordHash: await hashPassword(nuevaContrasena) } : {}) },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new UserError("Ya existe un usuario con ese email.");
    }
    throw error;
  }

  await logAudit(prisma, {
    userId: admin.id,
    action: "UPDATE",
    entityType: "Usuario",
    entityId: id,
    summary: `${name} (${email})`,
    cambios: [
      ...diffDeCampos(
        { name: antes.name, email: antes.email, rol: ROLE_LABELS[antes.role] },
        { name, email, rol: ROLE_LABELS[role] },
        CAMPOS_DEL_USUARIO
      ),
      // Que se cambió, nunca cuál es.
      ...(nuevaContrasena ? [{ campo: "Contrase\u00f1a", antes: null, despues: "cambiada" }] : []),
    ],
  });

  revalidatePath("/usuarios");
}

export async function toggleUserActive(formData: FormData) {
  const admin = await requireRole(["ADMIN"]);

  const id = String(formData.get("id") || "");
  const active = formData.get("active") === "true";
  if (!id) {
    throw new UserError("Falta el usuario.");
  }
  if (id === admin.id) {
    throw new UserError("No podés desactivar tu propio usuario.");
  }

  const target = await prisma.user.update({ where: { id }, data: { active: !active } });

  await logAudit(prisma, {
    userId: admin.id,
    action: "UPDATE",
    entityType: "Usuario",
    entityId: id,
    summary: `${target.name} — ${active ? "eliminado (desactivado)" : "reactivado"}`,
    cambios: [{ campo: "Activo", antes: active ? "s\u00ed" : "no", despues: active ? "no" : "s\u00ed" }],
  });

  revalidatePath("/usuarios");
}

/** Le saca el bloqueo por intentos fallidos a un usuario, sin esperar la hora. */
export async function desbloquearUsuario(formData: FormData) {
  const admin = await requireRole(["ADMIN"]);

  const id = String(formData.get("id") || "");
  const target = await prisma.user.findUnique({ where: { id } });
  if (!target) throw new UserError("El usuario ya no existe.");
  await limpiarIntentos(target.email);

  await logAudit(prisma, {
    userId: admin.id,
    action: "UPDATE",
    entityType: "Usuario",
    entityId: id,
    summary: `${target.name} — desbloqueado (intentos de entrada fallidos)`,
    cambios: [{ campo: "Bloqueado", antes: "s\u00ed", despues: "no" }],
  });

  revalidatePath("/usuarios");
}
