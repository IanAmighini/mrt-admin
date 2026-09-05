"use client";

import { userErrorMessage } from "@/lib/user-error";
import { useActionState, useEffect, useRef, useState } from "react";
import { Pencil, Plus, X, type LucideIcon } from "lucide-react";

const TRIGGER_ICONS: Record<string, LucideIcon> = {
  plus: Plus,
  edit: Pencil,
};

export function FormModal({
  triggerLabel,
  title,
  action,
  children,
  maxWidthClass = "max-w-lg",
  iconName = "plus",
}: {
  triggerLabel: string;
  title: string;
  action: (formData: FormData) => Promise<void>;
  children: React.ReactNode;
  maxWidthClass?: string;
  iconName?: keyof typeof TRIGGER_ICONS;
}) {
  const TriggerIcon = TRIGGER_ICONS[iconName];
  const dialogRef = useRef<HTMLDialogElement>(null);
  // Se incrementa cada vez que el <dialog> se cierra (submit exitoso, X, click afuera, Escape) —
  // al usarlo como key del <form> se fuerza a remontar los campos, así el próximo "Nuevo X" no
  // arranca con los valores/líneas que habían quedado cargados la vez anterior.
  const [resetKey, setResetKey] = useState(0);
  const [error, formAction, pending] = useActionState<string | null, FormData>(
    async (_prevState, formData) => {
      try {
        await action(formData);
        return null;
      } catch (e) {
        return userErrorMessage(e);
      }
    },
    null
  );

  const wasPending = useRef(false);
  useEffect(() => {
    if (wasPending.current && !pending && !error) {
      dialogRef.current?.close();
    }
    wasPending.current = pending;
  }, [pending, error]);

  return (
    <>
      <button
        type="button"
        onClick={() => dialogRef.current?.showModal()}
        className="flex w-fit items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary-hover"
      >
        <TriggerIcon size={16} />
        {triggerLabel}
      </button>
      <dialog
        ref={dialogRef}
        className={`fixed inset-0 m-auto w-full ${maxWidthClass} rounded-xl border border-foreground/10 bg-background p-0 text-foreground shadow-xl backdrop:bg-black/50`}
        onClick={(e) => {
          if (e.target === dialogRef.current) dialogRef.current?.close();
        }}
        onClose={() => setResetKey((k) => k + 1)}
      >
        <div className="space-y-4 p-6">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">{title}</h2>
            <button
              type="button"
              onClick={() => dialogRef.current?.close()}
              className="rounded-lg p-1 text-foreground/40 transition-colors hover:bg-foreground/5 hover:text-foreground"
              aria-label="Cerrar"
            >
              <X size={18} />
            </button>
          </div>
          {error && (
            <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-400">{error}</p>
          )}
          <form key={resetKey} action={formAction} className="space-y-3">
            {children}
          </form>
        </div>
      </dialog>
    </>
  );
}
