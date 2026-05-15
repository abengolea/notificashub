"use client";

import Link from "next/link";
import { useMemo, useSyncExternalStore } from "react";
import { DASHBOARD_TOKEN_STORAGE_KEY } from "@/lib/dashboard-session";
import { FacturacionPanel } from "@/app/admin/facturacion/facturacion-panel";

function tokenSubscribe() {
  return () => {};
}

function tokenSnapshot() {
  return sessionStorage.getItem(DASHBOARD_TOKEN_STORAGE_KEY);
}

function tokenServerSnapshot() {
  return null;
}

export default function FacturacionPage() {
  const token = useSyncExternalStore(tokenSubscribe, tokenSnapshot, tokenServerSnapshot);

  const authHeader = useMemo((): HeadersInit => {
    return token ? ({ Authorization: `Bearer ${token}` } as HeadersInit) : {};
  }, [token]);

  if (!token) {
    return (
      <div className="min-h-screen bg-zinc-100 dark:bg-zinc-900 flex items-center justify-center p-8">
        <div className="max-w-md text-center rounded-xl bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 p-8 shadow">
          <p className="text-zinc-700 dark:text-zinc-300 mb-4">
            Necesitás iniciar sesión en la página principal para acceder a clientes y facturación.
          </p>
          <Link
            href="/"
            className="inline-flex rounded-lg bg-emerald-600 px-5 py-2.5 font-medium text-white hover:bg-emerald-700"
          >
            Ir al dashboard
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-100 dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 p-6">
      <div className="max-w-7xl mx-auto">
        <header className="flex flex-wrap gap-4 items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold">Clientes y facturación — Notificas SRL</h1>
            <p className="text-sm text-zinc-500 mt-1">Alta de clientes recurrentes y emisión mensual en la contabilidad.</p>
          </div>
          <nav className="flex flex-wrap gap-4 items-center">
            <Link href="/" className="text-sm text-emerald-600 hover:text-emerald-700 font-medium">
              ← WhatsApp
            </Link>
            <Link href="/admin/contabilidad" className="text-sm text-emerald-600 hover:text-emerald-700 font-medium">
              Contabilidad
            </Link>
          </nav>
        </header>

        <FacturacionPanel authHeader={authHeader} />
      </div>
    </div>
  );
}
