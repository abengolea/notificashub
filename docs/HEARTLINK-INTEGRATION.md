# Integración HeartLink → NotificasHub (registro de usuarios)

Cuando un usuario nuevo se crea en HeartLink, debe registrarse en NotificasHub para que el router le enrute los mensajes de WhatsApp.

## Dónde agregar la llamada en HeartLink

Buscá en el código de HeartLink el lugar donde se **crea un usuario nuevo** (ej. al hacer signup, al agregar operador, al invitar). Suele estar en:

- **Firebase Auth** `onCreate` trigger (Cloud Function)
- **API route** que crea documento en `users/`
- **Admin panel** donde se agrega un operador

El flujo típico: se crea un documento en `users/{userId}` con campos como `phone`, `email`, `role`, etc.

## Código a agregar

```typescript
// Registrar en NotificasHub para que el router enrute mensajes WhatsApp
async function registerInNotificasHub(phone: string) {
  const baseUrl = process.env.NOTIFICASHUB_URL ?? "https://notificashub--studio-3864746689-59018.us-east4.hosted.app";
  const secret = process.env.INTERNAL_SECRET ?? "heartlink_internal_2026";

  const res = await fetch(`${baseUrl}/api/register-user`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-internal-token": secret,
    },
    body: JSON.stringify({
      phone: phone.replace(/\D/g, "").replace(/^0/, ""), // normalizar a formato internacional
      tenantId: "heartlink",
    }),
  });

  if (!res.ok) {
    console.error("[HeartLink] Error registrando en NotificasHub:", await res.text());
  }
}
```

## Dónde invocarlo

Luego de crear el usuario exitosamente, llamar:

```typescript
// Ejemplo: en Cloud Function onCreate de users
if (userData.phone) {
  await registerInNotificasHub(userData.phone);
}

// O en API route al crear usuario
await db.collection("users").doc(uid).set({ ... });
if (phone) {
  registerInNotificasHub(phone).catch(console.error); // fire-and-forget si no querés bloquear
}
```

## Variables de entorno en HeartLink

| Variable           | Valor                                                                 |
|--------------------|-----------------------------------------------------------------------|
| NOTIFICASHUB_URL   | `https://notificashub--studio-3864746689-59018.us-east4.hosted.app` |
| INTERNAL_SECRET    | `heartlink_internal_2026`                                            |

## Reenvío de mensajes (webhook incoming)

Cuando NotificasHub recibe un mensaje de Meta y lo reenvía a HeartLink (`/api/whatsapp/incoming`), el payload incluye el **objeto `message` completo** sin filtrar:

```json
{
  "message": { "id", "from", "timestamp", "type", "text"|"contacts"|"video"|..., ... },
  "from": "5491112345678",
  "contactName": "Nombre del usuario",
  "messageId": "wamid.xxx",
  "timestamp": "1234567890"
}
```

**Importante:** Para mensajes de tipo `contacts` (contacto compartido, ej. médico solicitante), el objeto `message` incluye `message.contacts` con la estructura que envía Meta (phones, wa_id, vcard, etc.). HeartLink debe usar ese array para extraer el teléfono del médico. No se debe depender solo del teléfono guardado en BD.

## Desregistro (opcional)

Si eliminás un usuario de HeartLink y querés que deje de recibir enrutado:

```typescript
await fetch(`${NOTIFICASHUB_URL}/api/register-user`, {
  method: "DELETE",
  headers: {
    "Content-Type": "application/json",
    "x-internal-token": INTERNAL_SECRET,
  },
  body: JSON.stringify({ phone, tenantId: "heartlink" }),
});
```
