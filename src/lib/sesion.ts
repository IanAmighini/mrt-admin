/**
 * Cuánto dura una sesión sin actividad, y cómo se cuenta.
 *
 * La computadora de la oficina queda prendida y sin llave, así que una sesión abierta de ayer es
 * una sesión que puede usar cualquiera que pase. Cuatro horas cubren una jornada partida al medio
 * sin obligar a entrar dos veces en la misma mañana.
 *
 * El plazo lo aplica la cookie de sesión y no un chequeo nuestro: `session.maxAge` en `auth.ts`
 * hace que cada pedido vuelva a emitirla con vencimiento dentro de cuatro horas (ver el `session`
 * de @auth/core, que la re-firma en cada lectura). O sea que el reloj se reinicia solo con usar la
 * app, y cuando se deja de usar la cookie simplemente caduca: no hay nada que limpiar ni ningún
 * estado que se pueda desincronizar.
 */
export const INACTIVIDAD_SEGUNDOS = 4 * 60 * 60;

/**
 * La marca de que acá había una sesión, para poder explicar por qué se cerró.
 *
 * Cuando la cookie de sesión caduca, el navegador la borra y no queda nada que distinguir "se te
 * venció" de "nunca entraste": las dos cosas llegan al login igual de vacías. Esta cookie dura
 * mucho más, así que si está y la de sesión no, lo que pasó fue inactividad.
 *
 * No guarda nada y no decide ningún permiso — sólo cambia el texto que se muestra. Por eso no
 * importa que sea falsificable: mentirla no abre ninguna puerta.
 */
export const COOKIE_HUBO_SESION = "mrt-hubo-sesion";

export const MOTIVO_INACTIVIDAD = "inactividad";
