import { requireUser } from "@/lib/auth-helpers";
import { ROLE_LABELS } from "@/lib/nav";

export default async function DashboardPage() {
  const user = await requireUser();

  return (
    <div>
      <h1 className="text-xl font-semibold mb-2">
        Hola, {(user.name ?? "").split(" ")[0]}
      </h1>
      <p className="text-black/60">
        Rol: {ROLE_LABELS[user.role]}. Elegí una sección del menú para empezar.
      </p>
    </div>
  );
}
