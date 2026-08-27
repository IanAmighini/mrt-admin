import { PagosPageContent } from "@/components/PagosPageContent";

export default async function PagosClientesPage() {
  return (
    <PagosPageContent typeFilter={["CLIENTE", "AMBOS"]} title="Pagos de Clientes" entityNoun="Cliente" />
  );
}
