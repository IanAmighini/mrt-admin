import { PagosPageContent } from "@/components/PagosPageContent";

export default async function PagosProveedoresPage() {
  return (
    <PagosPageContent
      typeFilter={["PROVEEDOR", "AMBOS"]}
      title="Pagos a Proveedores"
      entityNoun="Proveedor"
    />
  );
}
