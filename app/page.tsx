"use client";

import { useState, useEffect, useCallback } from "react";

const STATUS_ICONS: Record<string, string> = {
  sent: "⏳",
  delivered: "📬",
  read: "✅",
  failed: "❌",
};

type Message = {
  messageId: string;
  fecha: string | null;
  appId: string;
  numero: string;
  plantilla: string;
  status: string;
  sentAt?: string | null;
  deliveredAt?: string | null;
  readAt?: string | null;
};

type Stats = {
  totalToday: number;
  deliveredToday: number;
  readToday: number;
  failedToday: number;
};

type ApiResponse = {
  messages: Message[];
  stats: Stats;
  appIds: string[];
};

function formatFecha(iso: string | null): string {
  if (!iso) return "-";
  const d = new Date(iso);
  return d.toLocaleString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatHora(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleTimeString("es-AR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

const STORAGE_KEY = "dashboard-pwd";

export default function Home() {
  const [password, setPassword] = useState("");
  const [storedPassword, setStoredPassword] = useState<string | null>(null);

  useEffect(() => {
    setStoredPassword(sessionStorage.getItem(STORAGE_KEY));
  }, []);
  const [messages, setMessages] = useState<Message[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [appIds, setAppIds] = useState<string[]>([]);
  const [filterAppId, setFilterAppId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    const pwd = storedPassword || password;
    if (!pwd) return;

    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (filterAppId) params.set("appId", filterAppId);
      const res = await fetch(`/api/messages/list?${params}`, {
        headers: { "x-dashboard-password": pwd },
      });

      if (res.status === 401) {
        sessionStorage.removeItem(STORAGE_KEY);
        setStoredPassword(null);
        setError("Contraseña incorrecta");
        return;
      }

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setError(err.error || "Error al cargar datos");
        return;
      }

      const data: ApiResponse = await res.json();
      setMessages(data.messages);
      setStats(data.stats);
      setAppIds(data.appIds ?? []);
    } catch (e) {
      setError("Error de conexión");
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [storedPassword, password, filterAppId]);

  useEffect(() => {
    if (!storedPassword) return;
    fetchData();
  }, [storedPassword, filterAppId]);

  useEffect(() => {
    if (!storedPassword) return;
    const id = setInterval(fetchData, 10000);
    return () => clearInterval(id);
  }, [storedPassword, fetchData]);

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (!password.trim()) return;
    sessionStorage.setItem(STORAGE_KEY, password);
    setStoredPassword(password);
    setError(null);
  };

  const handleLogout = () => {
    sessionStorage.removeItem(STORAGE_KEY);
    setStoredPassword(null);
    setPassword("");
    setMessages([]);
    setStats(null);
  };

  if (!storedPassword) {
    return (
      <div className="min-h-screen bg-zinc-100 dark:bg-zinc-900 flex items-center justify-center p-4">
        <form
          onSubmit={handleLogin}
          className="w-full max-w-sm rounded-xl bg-white dark:bg-zinc-800 shadow-lg border border-zinc-200 dark:border-zinc-700 p-8"
        >
          <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100 mb-6">
            Dashboard WhatsApp
          </h1>
          <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
            Contraseña
          </label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-700 px-4 py-2 text-zinc-900 dark:text-zinc-100 focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
            placeholder="Contraseña del dashboard"
            autoFocus
          />
          {error && (
            <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>
          )}
          <button
            type="submit"
            className="mt-6 w-full rounded-lg bg-emerald-600 px-4 py-2 font-medium text-white hover:bg-emerald-700 transition-colors"
          >
            Entrar
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-100 dark:bg-zinc-900 p-6">
      <div className="max-w-7xl mx-auto">
        <header className="flex items-center justify-between mb-8">
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">
            Mensajes WhatsApp
          </h1>
          <button
            onClick={handleLogout}
            className="text-sm text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100"
          >
            Cerrar sesión
          </button>
        </header>

        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
            <div className="rounded-xl bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 p-5">
              <p className="text-sm text-zinc-500 dark:text-zinc-400">Total hoy</p>
              <p className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">
                {stats.totalToday}
              </p>
            </div>
            <div className="rounded-xl bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 p-5">
              <p className="text-sm text-zinc-500 dark:text-zinc-400">Delivered</p>
              <p className="text-2xl font-bold text-blue-600">{stats.deliveredToday}</p>
            </div>
            <div className="rounded-xl bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 p-5">
              <p className="text-sm text-zinc-500 dark:text-zinc-400">Read</p>
              <p className="text-2xl font-bold text-emerald-600">{stats.readToday}</p>
            </div>
            <div className="rounded-xl bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 p-5">
              <p className="text-sm text-zinc-500 dark:text-zinc-400">Failed</p>
              <p className="text-2xl font-bold text-red-600">{stats.failedToday}</p>
            </div>
          </div>
        )}

        <div className="mb-4 flex items-center gap-4">
          <label className="flex items-center gap-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Filtrar por appId:
            <select
              value={filterAppId}
              onChange={(e) => setFilterAppId(e.target.value)}
              className="rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-700 px-3 py-1.5 text-zinc-900 dark:text-zinc-100"
            >
              <option value="">Todos</option>
              {appIds.map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
            </select>
          </label>
          {loading && (
            <span className="text-sm text-zinc-500">Actualizando...</span>
          )}
          {error && <span className="text-sm text-red-600">{error}</span>}
        </div>

        <div className="rounded-xl bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px]">
              <thead>
                <tr className="border-b border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50">
                  <th className="text-left py-4 px-4 text-sm font-semibold text-zinc-700 dark:text-zinc-300">
                    Fecha
                  </th>
                  <th className="text-left py-4 px-4 text-sm font-semibold text-zinc-700 dark:text-zinc-300">
                    AppId
                  </th>
                  <th className="text-left py-4 px-4 text-sm font-semibold text-zinc-700 dark:text-zinc-300">
                    Número
                  </th>
                  <th className="text-left py-4 px-4 text-sm font-semibold text-zinc-700 dark:text-zinc-300">
                    Plantilla
                  </th>
                  <th className="text-left py-4 px-4 text-sm font-semibold text-zinc-700 dark:text-zinc-300">
                    Estado
                  </th>
                  <th className="text-left py-4 px-4 text-sm font-semibold text-zinc-700 dark:text-zinc-300" title="Progresión: sent → delivered → read">
                    ⏳ Sent
                  </th>
                  <th className="text-left py-4 px-4 text-sm font-semibold text-zinc-700 dark:text-zinc-300">
                    📬 Delivered
                  </th>
                  <th className="text-left py-4 px-4 text-sm font-semibold text-zinc-700 dark:text-zinc-300">
                    ✅ Read
                  </th>
                </tr>
              </thead>
              <tbody>
                {messages.map((m) => (
                  <tr
                    key={m.messageId}
                    className="border-b border-zinc-100 dark:border-zinc-700/50 hover:bg-zinc-50 dark:hover:bg-zinc-700/30"
                  >
                    <td className="py-3 px-4 text-sm text-zinc-700 dark:text-zinc-300">
                      {formatFecha(m.fecha)}
                    </td>
                    <td className="py-3 px-4 text-sm text-zinc-700 dark:text-zinc-300 font-mono">
                      {m.appId}
                    </td>
                    <td className="py-3 px-4 text-sm text-zinc-700 dark:text-zinc-300 font-mono">
                      {m.numero}
                    </td>
                    <td className="py-3 px-4 text-sm text-zinc-700 dark:text-zinc-300">
                      {m.plantilla}
                    </td>
                    <td className="py-3 px-4">
                      <span
                        className="inline-flex items-center gap-1 text-sm"
                        title={m.status}
                      >
                        {STATUS_ICONS[m.status] ?? "❓"} {m.status}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-xs text-zinc-500 dark:text-zinc-400 font-mono">
                      {formatHora(m.sentAt ?? m.fecha)}
                    </td>
                    <td className="py-3 px-4 text-xs text-zinc-500 dark:text-zinc-400 font-mono">
                      {formatHora(m.deliveredAt)}
                    </td>
                    <td className="py-3 px-4 text-xs text-zinc-500 dark:text-zinc-400 font-mono">
                      {formatHora(m.readAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {messages.length === 0 && !loading && (
            <p className="py-12 text-center text-zinc-500 dark:text-zinc-400">
              No hay mensajes para mostrar.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
