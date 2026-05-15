# Integración Náutica → NotificasHub (registro de usuarios)

Náutica debe tener configuradas las mismas variables de entorno que HeartLink para conectarse con NotificasHub. **Cada app usa su propio INTERNAL_SECRET.**

## Variables de entorno en Náutica

Agregar a `.env.local` (o la config de Náutica):

| Variable           | Valor                                                                 |
|--------------------|-----------------------------------------------------------------------|
| NOTIFICASHUB_URL   | `https://notificashub--studio-3864746689-59018.us-east4.hosted.app` |
| INTERNAL_SECRET    | *(el que da `npm run setup-tenant-nautica` en NotificasHub)*         |

**Importante:** El INTERNAL_SECRET de Náutica es **distinto** al de HeartLink. Obtenerlo ejecutando en NotificasHub:
```bash
npm run setup-tenant-nautica
```

---

## Código a agregar en Náutica

```typescript
// Registrar en NotificasHub para que el router enrute mensajes WhatsApp
async function registerInNotificasHub(phone: string) {
  const baseUrl = process.env.NOTIFICASHUB_URL ?? "https://notificashub--studio-3864746689-59018.us-east4.hosted.app";
  const secret = process.env.INTERNAL_SECRET; // El de Náutica, no el de HeartLink

  if (!secret) {
    console.error("[Náutica] INTERNAL_SECRET no configurado para NotificasHub");
    return;
  }

  const res = await fetch(`${baseUrl}/api/register-user`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-internal-token": secret,
    },
    body: JSON.stringify({
      phone: phone.replace(/\D/g, "").replace(/^0/, ""), // 3364645357 → 5493364645357
      tenantId: "WZAf1Mw08Uq047wneIxI", // O "nautica" si configuraste ese ID
    }),
  });

  if (!res.ok) {
    console.error("[Náutica] Error registrando en NotificasHub:", await res.text());
  }
}
```

## Dónde invocarlo

Al crear un usuario/cliente en Náutica (mismo flujo que HeartLink):

```typescript
// Cloud Function, API route o donde crees usuarios
if (userData.phone) {
  registerInNotificasHub(userData.phone).catch(console.error);
}
```

## Desregistro (opcional)

```typescript
await fetch(`${process.env.NOTIFICASHUB_URL}/api/register-user`, {
  method: "DELETE",
  headers: {
    "Content-Type": "application/json",
    "x-internal-token": process.env.INTERNAL_SECRET,
  },
  body: JSON.stringify({ phone, tenantId: "WZAf1Mw08Uq047wneIxI" }),
});
```

---

## Resumen: qué necesita cada app

| App       | NOTIFICASHUB_URL | INTERNAL_SECRET                  |
|-----------|------------------|----------------------------------|
| HeartLink | (mismo)          | heartlink_internal_2026          |
| Náutica   | (mismo)          | El de setup-tenant-nautica       |
