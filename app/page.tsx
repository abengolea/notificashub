"use client";

import { useState, useEffect, useCallback } from "react";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut as firebaseSignOut,
} from "firebase/auth";
import { app } from "@/lib/firebase";
import { DASHBOARD_TOKEN_STORAGE_KEY } from "@/lib/dashboard-session";

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

type AppStats = {
  appId: string;
  name: string;
  today: { total: number; paid: number };
  week: { total: number; paid: number };
  month: { total: number; paid: number };
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

export default function Home() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [storedToken, setStoredToken] = useState<string | null>(null);

  useEffect(() => {
    setStoredToken(sessionStorage.getItem(DASHBOARD_TOKEN_STORAGE_KEY));
  }, []);
  const [messages, setMessages] = useState<Message[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [appStats, setAppStats] = useState<AppStats[]>([]);
  const [appIds, setAppIds] = useState<string[]>([]);
  const [filterAppId, setFilterAppId] = useState("");
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    const token = storedToken;
    if (!token) return;

    setLoading(true);
    setError(null);
    try {
      const headers: HeadersInit = { Authorization: `Bearer ${token}` };
      const params = new URLSearchParams();
      if (filterAppId) params.set("appId", filterAppId);
      const res = await fetch(`/api/messages/list?${params}`, { headers });

      if (res.status === 401) {
        sessionStorage.removeItem(DASHBOARD_TOKEN_STORAGE_KEY);
        setStoredToken(null);
        setError("Sesión expirada. Volvé a iniciar sesión.");
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

      const statsRes = await fetch("/api/dashboard/stats-by-app", { headers });
      if (statsRes.ok) {
        const { apps } = await statsRes.json();
        setAppStats(apps ?? []);
      }
    } catch (e) {
      setError("Error de conexión");
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [storedToken, filterAppId]);

  useEffect(() => {
    if (!storedToken) return;
    fetchData();
  }, [storedToken, filterAppId]);

  useEffect(() => {
    if (!storedToken) return;
    const id = setInterval(fetchData, 10000);
    return () => clearInterval(id);
  }, [storedToken, fetchData]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password.trim()) return;
    setError(null);
    setLoading(true);
    try {
      const auth = getAuth(app);
      const userCred = await signInWithEmailAndPassword(auth, email.trim(), password);
      const token = await userCred.user.getIdToken();
      sessionStorage.setItem(DASHBOARD_TOKEN_STORAGE_KEY, token);
      setStoredToken(token);
    } catch (err: unknown) {
      const e = err as { code?: string; message?: string };
      const msg =
        e.code === "auth/invalid-credential"
          ? "Email o contraseña incorrectos"
          : e.code === "auth/user-not-found"
            ? "Usuario no existe. Creá el usuario en Firebase Console → Authentication → Users"
            : e.code === "auth/operation-not-allowed"
              ? "Email/Password no está habilitado. Habilitá en Firebase Console → Authentication → Sign-in method"
              : e.code === "auth/invalid-email"
                ? "Email inválido"
                : e?.message ?? "Error al iniciar sesión";
      setError(msg);
      console.error("[Login error]", e.code, e.message);
    } finally {
      setLoading(false);
    }
  };

  const loginWithGooglePopup = async () => {
    setError(null);
    setGoogleLoading(true);
    try {
      const auth = getAuth(app);
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account" });
      const userCred = await signInWithPopup(auth, provider);
      const token = await userCred.user.getIdToken();
      sessionStorage.setItem(DASHBOARD_TOKEN_STORAGE_KEY, token);
      setStoredToken(token);
    } catch (err: unknown) {
      const e = err as { code?: string; message?: string };
      const msg =
        e.code === "auth/popup-closed-by-user"
          ? "Inicio cancelado."
          : e.code === "auth/popup-blocked"
            ? "El navegador bloqueó la ventana de Google. Permití ventanas emergentes para este sitio."
            : e.code === "auth/account-exists-with-different-credential"
              ? "Ese email ya está registrado con otro método. Usá email y contraseña o la cuenta Google correcta."
              : e.code === "auth/operation-not-allowed"
                ? "Google no está habilitado en Firebase. Activá «Google» en Authentication → Sign-in method."
                : e?.message ?? "Error al iniciar sesión con Google";
      setError(msg);
      console.error("[Google login error]", e.code, e.message);
    } finally {
      setGoogleLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      const auth = getAuth(app);
      await firebaseSignOut(auth);
    } catch {
      // ignore
    }
    sessionStorage.removeItem(DASHBOARD_TOKEN_STORAGE_KEY);
    setStoredToken(null);
    setEmail("");
    setPassword("");
    setMessages([]);
    setStats(null);
    setAppStats([]);
  };

  if (!storedToken) {
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
            Email
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-700 px-4 py-2 text-zinc-900 dark:text-zinc-100 focus:ring-2 focus:ring-emerald-500 focus:border-transparent mb-4"
            placeholder="admin@ejemplo.com"
            autoComplete="email"
          />
          <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
            Contraseña
          </label>
          <div className="relative">
            <input
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-700 px-4 py-2 pr-12 text-zinc-900 dark:text-zinc-100 focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
              placeholder="Contraseña"
              autoComplete="current-password"
            />
            <button
              type="button"
              onClick={() => setShowPassword((s) => !s)}
              className="absolute right-2 top-1/2 -translate-y-1/2 px-2 py-1 text-sm text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
              tabIndex={-1}
              title={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
            >
              {showPassword ? "Ocultar" : "Mostrar"}
            </button>
          </div>
          {error && (
            <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>
          )}
          <button
            type="submit"
            disabled={loading || googleLoading}
            className="mt-6 w-full rounded-lg bg-emerald-600 px-4 py-2 font-medium text-white hover:bg-emerald-700 transition-colors disabled:opacity-50"
          >
            {loading ? "Entrando..." : "Entrar"}
          </button>

          <div className="my-6 flex items-center gap-3">
            <span className="h-px flex-1 bg-zinc-200 dark:bg-zinc-600" aria-hidden />
            <span className="text-xs font-medium uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
              o
            </span>
            <span className="h-px flex-1 bg-zinc-200 dark:bg-zinc-600" aria-hidden />
          </div>

          <button
            type="button"
            disabled={loading || googleLoading}
            onClick={() => void loginWithGooglePopup()}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-700 px-4 py-2.5 font-medium text-zinc-800 dark:text-zinc-100 shadow-sm hover:bg-zinc-50 dark:hover:bg-zinc-600/80 transition-colors disabled:opacity-50"
          >
            <svg className="h-5 w-5 shrink-0" viewBox="0 0 24 24" aria-hidden>
              <path
                fill="#4285F4"
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              />
              <path
                fill="#34A853"
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              />
              <path
                fill="#FBBC05"
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
              />
              <path
                fill="#EA4335"
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
              />
            </svg>
            {googleLoading ? "Conectando con Google..." : "Continuar con Google"}
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
          <nav className="flex items-center gap-5">
            <a
              href="/admin/facturacion"
              className="text-sm font-medium text-emerald-600 dark:text-emerald-400 hover:underline"
            >
              Clientes y facturación
            </a>
            <a
              href="/admin/contabilidad"
              className="text-sm font-medium text-emerald-600 dark:text-emerald-400 hover:underline"
            >
              Contabilidad (Notificas SRL)
            </a>
            <button
              type="button"
              onClick={handleLogout}
              className="text-sm text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100"
            >
              Cerrar sesión
            </button>
          </nav>
        </header>

        {appStats.length > 0 && (
          <section className="mb-8">
            <h2 className="text-lg font-semibold text-zinc-800 dark:text-zinc-200 mb-1">
              Mensajes pagos por app
            </h2>
            <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-4">
              (paid / total) — Click para filtrar la tabla
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {appStats.map((app) => (
                <button
                  key={app.appId}
                  type="button"
                  onClick={() => setFilterAppId((prev) => (prev === app.appId ? "" : app.appId))}
                  className={`text-left rounded-xl bg-white dark:bg-zinc-800 border p-5 transition-colors ${
                    filterAppId === app.appId
                      ? "border-emerald-500 ring-2 ring-emerald-500/30"
                      : "border-zinc-200 dark:border-zinc-700 hover:border-emerald-400/50"
                  }`}
                >
                  <h3 className="font-semibold text-zinc-900 dark:text-zinc-100 mb-3">
                    {app.name}
                  </h3>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400 font-mono mb-3">
                    {app.appId}
                  </p>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-zinc-600 dark:text-zinc-400">Hoy</span>
                      <span>
                        <strong className="text-amber-600 dark:text-amber-400">{app.today.paid}</strong>
                        <span className="text-zinc-400 mx-1">/</span>
                        {app.today.total}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-zinc-600 dark:text-zinc-400">Semana</span>
                      <span>
                        <strong className="text-amber-600 dark:text-amber-400">{app.week.paid}</strong>
                        <span className="text-zinc-400 mx-1">/</span>
                        {app.week.total}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-zinc-600 dark:text-zinc-400">Mes</span>
                      <span>
                        <strong className="text-amber-600 dark:text-amber-400">{app.month.paid}</strong>
                        <span className="text-zinc-400 mx-1">/</span>
                        {app.month.total}
                      </span>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </section>
        )}

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
