import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { prisma } from "@/lib/prisma";
import { verifyPassword } from "@/lib/password";
import type { UserRole } from "@prisma/client";
import { INACTIVIDAD_SEGUNDOS } from "@/lib/sesion";

export const { handlers, auth, signIn, signOut } = NextAuth({
  // `maxAge` sobre una sesión JWT es un plazo que se renueva: cada pedido vuelve a emitir la cookie
  // con vencimiento dentro de este rato, así que en la práctica es un límite de inactividad.
  session: { strategy: "jwt", maxAge: INACTIVIDAD_SEGUNDOS },
  pages: { signIn: "/login" },
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Contraseña", type: "password" },
      },
      authorize: async (credentials) => {
        const email = credentials?.email;
        const password = credentials?.password;
        if (typeof email !== "string" || typeof password !== "string") {
          return null;
        }

        const user = await prisma.user.findUnique({ where: { email } });
        if (!user || !user.active) {
          return null;
        }

        const valid = await verifyPassword(password, user.passwordHash);
        if (!valid) {
          return null;
        }

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
        };
      },
    }),
  ],
  callbacks: {
    jwt: async ({ token, user }) => {
      if (user) {
        token.role = user.role as UserRole;
        token.id = user.id as string;
        token.revisadoEn = Date.now();
        return token;
      }
      // La sesión dura mientras se use, así que sin esto un usuario desactivado —o al que se le
      // bajó el rol— seguía entrando con lo que tenía hasta que dejara la app un rato. Se vuelve a
      // mirar en la base cada minuto: si ya no está activo la sesión se corta, y el rol es el de ahora.
      if (token.id && Date.now() - Number(token.revisadoEn ?? 0) > 60_000) {
        const actual = await prisma.user.findUnique({
          where: { id: token.id as string },
          select: { active: true, role: true, name: true },
        });
        if (!actual || !actual.active) return null;
        token.role = actual.role;
        token.name = actual.name;
        token.revisadoEn = Date.now();
      }
      return token;
    },
    session: ({ session, token }) => {
      if (session.user) {
        session.user.id = token.id as string;
        session.user.role = token.role as UserRole;
      }
      return session;
    },
  },
});
