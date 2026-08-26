import { PagosPageContent } from "@/components/PagosPageContent";

export default async function PagosClientesPage({
  searchParams,
}: {
  searchParams: Promise<{ entityId?: string }>;
}) {
  const { entityId } = await searchParams;
  return (
    <PagosPageContent
      typeFilter={["CLIENTE", "AMBOS"]}
      title="Pagos de Clientes"
      entityNoun="Cliente"
      entityId={entityId}
    />
  );
}
