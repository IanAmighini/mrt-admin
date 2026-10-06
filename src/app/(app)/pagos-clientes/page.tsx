import { PagosPageContent, type FiltrosDePagos } from "@/components/PagosPageContent";

export default async function PagosClientesPage({ searchParams }: { searchParams: Promise<FiltrosDePagos> }) {
  return (
    <PagosPageContent
      typeFilter={["CLIENTE", "AMBOS"]}
      title="Cobros de Clientes"
      entityNoun="Cliente"
      basePath="/pagos-clientes"
      filtros={await searchParams}
    />
  );
}
