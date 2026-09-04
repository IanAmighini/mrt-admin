import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { NAV_ITEMS } from "@/lib/nav";

export default auth((req) => {
  const { pathname } = req.nextUrl;
  const isLoggedIn = !!req.auth?.user;

  if (pathname === "/login") {
    if (isLoggedIn) {
      return NextResponse.redirect(new URL("/", req.url));
    }
    return NextResponse.next();
  }

  if (!isLoggedIn) {
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // El item de nav más específico que matchea esta ruta manda qué roles pueden entrar — mismo
  // NAV_ITEMS que decide qué se muestra en el menú, así no hay que mantener una lista aparte acá.
  const matchedItem = NAV_ITEMS.filter(
    (item) => item.href !== "/" && pathname.startsWith(item.href)
  ).sort((a, b) => b.href.length - a.href.length)[0];
  if (matchedItem && !matchedItem.roles.includes(req.auth!.user.role)) {
    return NextResponse.redirect(new URL("/", req.url));
  }

  return NextResponse.next();
});

export const config = {
  /**
   * Los archivos estáticos quedan afuera por extensión: sin esto, alguien sin sesión pide
   * /logo.png, el middleware lo manda a /login y el <img> termina recibiendo HTML (por eso el
   * logo se veía roto justamente en la pantalla de login). Lo mismo aplica al manifest y a los
   * íconos, que iOS pide sin sesión al ofrecer "Agregar a pantalla de inicio".
   *
   * `api/cron` también queda afuera, y es importante entender por qué: esas rutas las llama
   * Vercel Cron sin sesión, autenticándose con un token. Si el middleware las redirigiera al
   * login, el job **desaparecería en silencio** — Vercel Cron no sigue redirects y ni siquiera
   * los registra en el log, así que no habría forma de darse cuenta de que nunca corrió. El
   * handler valida el token por su cuenta.
   *
   * Ojo: se excluye `api/cron`, no todo `/api` — `/api/buscar` sí necesita el chequeo de sesión.
   */
  matcher: [
    "/((?!api/auth|api/cron|_next/static|_next/image|.*\\.(?:png|jpg|jpeg|gif|svg|ico|webp|webmanifest)$).*)",
  ],
};
