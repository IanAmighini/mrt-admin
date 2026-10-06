import { PagosPageContent, type FiltrosDePagos } from "@/components/PagosPageContent";

export default async function PagosProveedoresPage({ searchParams }: { searchParams: Promise<FiltrosDePagos> }) {
  return (
    <PagosPageContent
      typeFilter={["PROVEEDOR", "AMBOS"]}
      title="Pagos a Proveedores"
      entityNoun="Proveedor"
      basePath="/pagos-proveedores"
      filtros={await searchParams}
    />
  );
}
