import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

function canRunOpenSsl(exe: string): boolean {
  try {
    execFileSync(exe, ["version"], {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    return true;
  } catch {
    return false;
  }
}

const WIN32_OPENSSL_CANDIDATES = [
  String.raw`C:\Program Files\OpenSSL-Win64\bin\openssl.exe`,
  String.raw`C:\Program Files\OpenSSL\bin\openssl.exe`,
  String.raw`C:\Program Files (x86)\OpenSSL-Win32\bin\openssl.exe`,
  String.raw`C:\Program Files\Git\usr\bin\openssl.exe`,
  String.raw`C:\Program Files\Git\mingw64\bin\openssl.exe`,
] as const;

/**
 * Resuelve un OpenSSL ejecutable para WSAA (cms -sign).
 * Orden: OPENSSL_PATH → `openssl` en PATH → rutas típicas en Windows (Git / Win64 OpenSSL).
 */
export function resolveOpenSslForAfip(opensslPathFromEnv: string | undefined): string {
  if (opensslPathFromEnv?.trim()) {
    const p = opensslPathFromEnv.trim();
    if (canRunOpenSsl(p)) {
      return p;
    }
    throw new Error(
      `OPENSSL_PATH apunta a un ejecutable que no responde a "openssl version": ${p}`,
    );
  }

  if (canRunOpenSsl("openssl")) {
    return "openssl";
  }

  if (process.platform === "win32") {
    for (const candidate of WIN32_OPENSSL_CANDIDATES) {
      if (existsSync(candidate) && canRunOpenSsl(candidate)) {
        return candidate;
      }
    }
  }

  const hint =
    process.platform === "win32"
      ? "Instalá OpenSSL (https://slproweb.com/products/Win32OpenSSL.html), o Git for Windows (incluye openssl.exe), o agregá OpenSSL al PATH, o definí OPENSSL_PATH en .env (ej. C:/Program Files/OpenSSL-Win64/bin/openssl.exe)."
      : "Instalá openssl en el sistema o definí OPENSSL_PATH en .env.";

  throw new Error(`No se encontró OpenSSL en PATH ni en rutas típicas de Windows. ${hint}`);
}

/**
 * @deprecated Usar resolveOpenSslForAfip para descubrir rutas en Windows.
 */
export function resolveOpenSslExecutable(opensslPathFromEnv: string | undefined): string {
  if (opensslPathFromEnv && opensslPathFromEnv.trim() !== "") {
    return opensslPathFromEnv.trim();
  }
  return "openssl";
}

/** Verifica que OpenSSL esté disponible; si no, mensaje con hint para Windows. */
export function assertOpenSslAvailable(opensslExe: string): void {
  if (!canRunOpenSsl(opensslExe)) {
    const hint =
      process.platform === "win32"
        ? "Instalá OpenSSL (ej. https://slproweb.com/products/Win32OpenSSL.html) o definí OPENSSL_PATH en .env apuntando a openssl.exe (ej. C:/Program Files/OpenSSL-Win64/bin/openssl.exe)."
        : "Instalá el paquete openssl y asegurate de que esté en PATH, o definí OPENSSL_PATH.";
    throw new Error(`No se pudo ejecutar OpenSSL (${opensslExe}). ${hint}`);
  }
}

export function signTraWithOpenSslDer(params: {
  opensslExe: string;
  traXmlPath: string;
  certPath: string;
  keyPath: string;
  /** PEM con CA intermedias (y opcionalmente raíz) para `-certfile` al firmar el TRA (PKCS#7 como PyAFIPWS / `smime -sign`). */
  chainPemPath?: string;
  cmsDerOutPath: string;
}): void {
  const { opensslExe, traXmlPath, certPath, keyPath, chainPemPath, cmsDerOutPath } = params;
  // WSAA (Axis) suele validar el mismo PKCS#7 que genera PyAFIPWS: `smime -sign`, no `cms -sign`.
  // `-binary` evita normalizar el XML del TRA; `-certfile` agrega la cadena al SignedData.
  const args = [
    "smime",
    "-sign",
    "-binary",
    "-in",
    traXmlPath,
    "-signer",
    certPath,
    "-inkey",
    keyPath,
    ...(chainPemPath && existsSync(chainPemPath) ? (["-certfile", chainPemPath] as const) : []),
    "-nodetach",
    "-outform",
    "DER",
    "-out",
    cmsDerOutPath,
  ] as string[];
  try {
    execFileSync(opensslExe, args, {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
  } catch (e) {
    const stderr =
      e && typeof e === "object" && "stderr" in e
        ? String((e as { stderr: unknown }).stderr)
        : e instanceof Error
          ? e.message
          : String(e);
    throw new Error(
      `OpenSSL smime -sign falló (no se muestran certificados ni claves). Detalle: ${stderr.slice(0, 500)}`,
    );
  }
}
