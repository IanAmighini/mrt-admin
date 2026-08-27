"use client";

import { useActionState, useEffect, useRef } from "react";

export function FormModal({
  triggerLabel,
  title,
  action,
  children,
  maxWidthClass = "max-w-lg",
}: {
  triggerLabel: string;
  title: string;
  action: (formData: FormData) => Promise<void>;
  children: React.ReactNode;
  maxWidthClass?: string;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [error, formAction, pending] = useActionState<string | null, FormData>(
    async (_prevState, formData) => {
      try {
        await action(formData);
        return null;
      } catch (e) {
        return e instanceof Error ? e.message : "Ocurrió un error.";
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
        className="w-fit rounded bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary-hover"
      >
        {triggerLabel}
      </button>
      <dialog
        ref={dialogRef}
        className={`fixed inset-0 m-auto w-full ${maxWidthClass} rounded-lg border border-black/10 p-0 backdrop:bg-black/50`}
        onClick={(e) => {
          if (e.target === dialogRef.current) dialogRef.current?.close();
        }}
      >
        <div className="space-y-4 p-6">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">{title}</h2>
            <button
              type="button"
              onClick={() => dialogRef.current?.close()}
              className="text-black/40 hover:text-black"
              aria-label="Cerrar"
            >
              ×
            </button>
          </div>
          {error && (
            <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
          )}
          <form action={formAction} className="space-y-3">
            {children}
          </form>
        </div>
      </dialog>
    </>
  );
}
