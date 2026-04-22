# Checklist: verificar que HeartLink no cause problemas

Instrucciones para revisar el proyecto **HeartLink** antes de deploy, evitando errores como los de nauticadmin (useSearchParams, etc.).

---

## 1. Abrir el proyecto HeartLink

Reemplazá con la ruta real de tu proyecto HeartLink (ej. `C:\Users\Adrian\Documents\mis-proyectos\heartlink` o donde lo tengas).

```powershell
cd C:\Users\Adrian\Documents\mis-proyectos\heartlink
```

*(Si no sabés dónde está: File Explorer → buscar carpeta con `package.json` y `next.config` de HeartLink)*

---

## 2. Errores de build (Next.js 15)

### 2.1 Buscar useSearchParams sin Suspense

**PowerShell (Windows):**
```powershell
Get-ChildItem -Recurse -Include *.tsx,*.jsx | Select-String "useSearchParams"
```

**Git Bash / WSL / Linux:**
```bash
grep -r "useSearchParams" --include="*.tsx" --include="*.jsx" .
```

**Si hay resultados:** Cada uso debe estar dentro de un `<Suspense>` boundary o la página debe tener `export const dynamic = "force-dynamic"`.

**Fix típico:**
```tsx
// Antes (rompe build)
export default function Page() {
  const params = useSearchParams();
  return <div>...</div>;
}

// Después (correcto)
export default function Page() {
  return (
    <Suspense fallback={<div>Cargando...</div>}>
      <PageContent />
    </Suspense>
  );
}
function PageContent() {
  const params = useSearchParams();
  return <div>...</div>;
}
```

### 2.2 Build local

```powershell
npm run build
```

Si falla, corregir antes de hacer deploy.

---

## 3. Endpoint WhatsApp incoming

HeartLink debe exponer un endpoint que NotificasHub llama al reenviar mensajes:

| Ruta | Método | Uso |
|------|--------|-----|
| `/api/whatsapp/incoming` | POST | Recibe mensajes de NotificasHub |

**Verificar:**
- Que exista `app/api/whatsapp/incoming/route.ts` (o equivalente)
- Que valide el header `x-internal-token` contra `INTERNAL_SECRET`
- Que procese el body: `{ message, from, contactName, messageId, timestamp }`

---

## 4. Variables de entorno en producción

En App Hosting / Cloud Run de HeartLink:

| Variable | Requerida | Notas |
|----------|-----------|-------|
| `INTERNAL_SECRET` | Sí | Debe coincidir con el de NotificasHub (`heartlink_internal_2026`) |
| `NOTIFICASHUB_URL` | Opcional | Para registrar usuarios. Por defecto: URL de NotificasHub |

---

## 5. Test rápido de integración

Desde NotificasHub, probar que HeartLink responde:

```bash
# Desde notificas-hub
curl -X POST "https://heartlink--heartlink-f4ftq.us-central1.hosted.app/api/whatsapp/incoming" \
  -H "Content-Type: application/json" \
  -H "x-internal-token: heartlink_internal_2026" \
  -d '{"message":{"id":"test","from":"5491112345678","timestamp":"123","type":"text","text":{"body":"test"}},"from":"5491112345678","messageId":"test","timestamp":"123"}'
```

Respuesta esperada: 200 (o el status que devuelva HeartLink si procesa el mensaje).

---

## 6. Otros puntos que suelen romper build (Next.js 15)

- `useRouter()` en páginas estáticas sin `dynamic = "force-dynamic"`
- Imports que usan `window`/`document` en el top-level
- `next/dynamic` mal configurado
- Opciones deprecadas en `next.config` (ej. `proxyClientMaxBodySize` en experimental)

---

## Resumen

| Paso | Comando / Acción |
|------|------------------|
| 1 | `grep -r "useSearchParams" .` → Revisar Suspense |
| 2 | `npm run build` → Debe completar sin errores |
| 3 | Confirmar que existe `/api/whatsapp/incoming` |
| 4 | Verificar `INTERNAL_SECRET` en prod |
| 5 | Opcional: probar con `curl` el endpoint incoming |
