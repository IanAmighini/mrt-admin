# Envasadora — Sistema de Gestión

Sistema web interno (multiusuario, con roles) para reemplazar las planillas de cuentas
corrientes, stock, producción y pallets de la envasadora de aceite. Ver
[docs/spec-sistema-envasadora.md](docs/spec-sistema-envasadora.md) para la especificación
funcional completa.

Stack: Next.js (App Router, TypeScript) + Postgres + Prisma + NextAuth (Credentials).

## Setup local

1. Instalar dependencias:

   ```bash
   npm install
   ```

2. Crear un proyecto Postgres en [Neon](https://neon.tech) o [Supabase](https://supabase.com)
   y copiar el connection string.

3. Copiar `.env.example` a `.env` y completar:
   - `DATABASE_URL`: el connection string del paso anterior.
   - `AUTH_SECRET`: generar con `npx auth secret`.
   - `SEED_ADMIN_EMAIL`, `SEED_ADMIN_NAME`, `SEED_ADMIN_PASSWORD`: datos del primer usuario
     Admin (después se puede cambiar la contraseña o crear más usuarios desde `/usuarios`).

4. Crear las tablas y sembrar el usuario admin inicial:

   ```bash
   npx prisma migrate dev --name init
   npx prisma db seed
   ```

5. Levantar el servidor de desarrollo:

   ```bash
   npm run dev
   ```

   Abrir [http://localhost:3000](http://localhost:3000) — redirige a `/login`.

## Roles

- **Admin**: acceso total, incluye `/usuarios` (alta de usuarios y asignación de rol).
- **Carga diaria**: puede cargar entidades, remitos, pagos, producción y stock (sin acceso a
  reportes gerenciales ni a `/usuarios`).
- **Solo lectura**: ve dashboards y cuentas corrientes, no puede crear ni editar.

## Estado del proyecto

- ✅ Módulo 1 — Modelo de datos base, autenticación y roles, alta de clientes/proveedores
  (con sus dos cuentas corrientes Blanco/Negro), administración de usuarios.
- ⏳ Módulo 2 — Cuentas corrientes (remitos, facturas, pagos, imputación FIFO/manual).
- ⏳ Módulo 3 — Stock de insumos, recetas (BOM) y producción diaria.
- ⏳ Módulo 4 — Armado/desarmado de pallets.
- ⏳ Módulo 5 — Dashboards con datos reales y reportes gerenciales.

## Comandos útiles

```bash
npm run dev          # servidor de desarrollo
npm run build         # build de producción
npm run lint           # eslint
npx tsc --noEmit        # chequeo de tipos
npx prisma studio        # explorar la base de datos
npx prisma migrate dev    # aplicar cambios de schema en desarrollo
```
