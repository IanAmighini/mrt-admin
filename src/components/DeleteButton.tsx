"use client";

import { useActionState } from "react";
import { Trash2 } from "lucide-react";

export function DeleteButton({
  action,
  hiddenName,
  hiddenValue,
  confirmMessage,
}: {
  action: (formData: FormData) => Promise<void>;
  hiddenName: string;
  hiddenValue: string;
  confirmMessage: string;
}) {
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

  return (
    <div>
      <form
        action={formAction}
        onSubmit={(e) => {
          if (!window.confirm(confirmMessage)) e.preventDefault();
        }}
      >
        <input type="hidden" name={hiddenName} value={hiddenValue} />
        <button
          type="submit"
          disabled={pending}
          className="flex items-center gap-1 text-xs text-red-600 underline underline-offset-2 hover:text-red-700 disabled:opacity-50 dark:text-red-400 dark:hover:text-red-300"
        >
          <Trash2 size={13} />
          {pending ? "Borrando…" : "Borrar"}
        </button>
      </form>
      {error && <p className="mt-1 max-w-xs text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}
