-- CreateTable
CREATE TABLE "IntentoDeLogin" (
    "email" TEXT NOT NULL,
    "fallidos" INTEGER NOT NULL DEFAULT 0,
    "ultimoFallo" TIMESTAMP(3) NOT NULL,
    "bloqueadoHasta" TIMESTAMP(3),

    CONSTRAINT "IntentoDeLogin_pkey" PRIMARY KEY ("email")
);

