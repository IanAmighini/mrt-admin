import { PagosPageContent } from "@/components/PagosPageContent";

export default async function PagosClientesPage() {
  return (
    <PagosPageContent typeFilter={["CLIENTE", "AMBOS"]} title="Cobros de Clientes" entityNoun="Cliente" />
  );
}
