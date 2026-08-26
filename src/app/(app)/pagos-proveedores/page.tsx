import { PagosPageContent } from "@/components/PagosPageContent";

export default async function PagosProveedoresPage({
  searchParams,
}: {
  searchParams: Promise<{ entityId?: string }>;
}) {
  const { entityId } = await searchParams;
  return (
    <PagosPageContent
      typeFilter={["PROVEEDOR", "AMBOS"]}
      title="Pagos a Proveedores"
      entityNoun="Proveedor"
      entityId={entityId}
    />
  );
}
