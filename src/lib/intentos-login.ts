// Sin "server-only": lo importa auth.ts, que también corre en el proxy.
import { prisma } from "@/lib/prisma";
import { TIMEZONE } from "@/lib/period";

/**
 * Freno a probar contraseñas: al quinto intento fallido el email queda bloqueado una hora, y
 * mientras tanto ni se mira la contraseña. Los fallos sueltos no se juntan para siempre: si pasó
 * más de una hora del último, la cuenta empieza de nuevo.
 */
export const MAX_INTENTOS = 5;
const ESPERA_MS = 60 * 60 * 1000;

const clave = (email: string) => email.trim().toLowerCase();

/** Hasta cuándo está bloqueado, o null si puede probar. */
export async function bloqueadoHasta(email: string): Promise<Date | null> {
  const intento = await prisma.intentoDeLogin.findUnique({ where: { email: clave(email) } });
  return intento?.bloqueadoHasta && intento.bloqueadoHasta > new Date() ? intento.bloqueadoHasta : null;
}

/** Anota un fallo y devuelve cuántos intentos le quedan antes del bloqueo (0 = recién bloqueado). */
export async function registrarFallo(email: string): Promise<number> {
  const ahora = new Date();
  const anterior = await prisma.intentoDeLogin.findUnique({ where: { email: clave(email) } });
  // Un bloqueo vencido, o un fallo de hace rato, no cuentan: se arranca de cero.
  const vigente = anterior && ahora.getTime() - anterior.ultimoFallo.getTime() < ESPERA_MS && !anterior.bloqueadoHasta;
  const fallidos = (vigente ? anterior.fallidos : 0) + 1;
  const bloquear = fallidos >= MAX_INTENTOS;
  const datos = {
    fallidos,
    ultimoFallo: ahora,
    bloqueadoHasta: bloquear ? new Date(ahora.getTime() + ESPERA_MS) : null,
  };
  await prisma.intentoDeLogin.upsert({ where: { email: clave(email) }, create: { email: clave(email), ...datos }, update: datos });
  return Math.max(MAX_INTENTOS - fallidos, 0);
}

/** Cuántos intentos le quedan antes del bloqueo, para avisar cuando son pocos. */
export async function intentosQueQuedan(email: string): Promise<number> {
  const intento = await prisma.intentoDeLogin.findUnique({ where: { email: clave(email) } });
  if (!intento || intento.bloqueadoHasta || Date.now() - intento.ultimoFallo.getTime() >= ESPERA_MS) return MAX_INTENTOS;
  return Math.max(MAX_INTENTOS - intento.fallidos, 0);
}

/** Entró bien, o un administrador lo desbloqueó: se olvidan los fallos. */
export async function limpiarIntentos(email: string) {
  await prisma.intentoDeLogin.deleteMany({ where: { email: clave(email) } });
}

/** Los emails bloqueados ahora mismo, con hasta cuándo: para mostrarlo en Usuarios. */
export async function bloqueosVigentes(): Promise<Map<string, Date>> {
  const filas = await prisma.intentoDeLogin.findMany({ where: { bloqueadoHasta: { gt: new Date() } } });
  return new Map(filas.map((f) => [f.email, f.bloqueadoHasta!]));
}

/** "15:42", en hora argentina: el servidor corre en UTC. */
export function horaDeDesbloqueo(hasta: Date) {
  return hasta.toLocaleTimeString("es-AR", { timeZone: TIMEZONE, hour: "2-digit", minute: "2-digit", hour12: false });
}
