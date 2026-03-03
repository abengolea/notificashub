# NotificasHub

Hub central para WhatsApp Cloud API (Meta) con soporte **multi-tenant**. Enruta mensajes entrantes al tenant correcto según membresías, referral tokens y preferencias del usuario.

## WhatsApp Router multi-tenant

### Flujo

1. **Mensaje entrante** → Webhook Meta recibe el payload
2. **Idempotencia** → Se verifica `wa_messages` por `message.id`; si existe, se ignora (Meta reintenta)
3. **Resolución de tenant** → `resolveTenant(phone, message)` determina la acción
4. **Acciones**:
   - `silent_unregistered`: Número no registrado → no responder (auditoría sí)
   - `silent_or_handoff`: Máx intentos en ask_choice superados → silencio
   - `route`: Enviar mensaje al webhook del tenant (HeartLink, Náutica, etc.)
   - `ask_choice`: Usuario con 2+ tenants → enviar lista "¿Por cuál servicio consultás?"

### Variables de entorno

```bash
# WhatsApp Cloud API (Meta)
WHATSAPP_PHONE_NUMBER_ID=
WHATSAPP_ACCESS_TOKEN=
WHATSAPP_VERIFY_TOKEN=notificas_webhook_2026

# Firebase Admin
GOOGLE_APPLICATION_CREDENTIALS=  # ruta al JSON de clave privada

# Tenants (fallback para HeartLink si no está en Firestore)
HEARTLINK_URL=https://heartlink--heartlink-f4ftq.us-central1.hosted.app
INTERNAL_SECRET=heartlink_internal_2026
```

### Modelo de datos (Firestore)

| Colección          | Documento       | Campos principales                                           |
|--------------------|------------------|--------------------------------------------------------------|
| `tenants`          | tenantId         | name, status, referralTokens[], webhookUrl, internalSecret  |
| `user_memberships` | phone_sanitized  | phone, tenantIds[], updatedAt                               |
| `wa_sessions`      | sessionKey       | phone, conversationId?, activeTenantId, state, expiresAt      |
| `wa_messages`      | messageId (Meta) | direction, phone, tenantId?, payload, createdAt, pricingCategory |
| `wa_pending_choices` | phone_sanitized | options[], expiresAt (10 min), attempts                       |
| `wa_last_tenant`   | phone_sanitized  | tenantId, updatedAt (vence lógico 30 días)                   |

### Ejemplos wa.me con texto prefijado

- `https://wa.me/5491112345678?text=RIVER` → usuario entra con "RIVER" → inferir Escuela River
- `https://wa.me/5491112345678?text=NAUTICA` → inferir Náutica
- `https://wa.me/5491112345678?text=HEARTLINK` → inferir HeartLink

Configurar `referralTokens` en cada tenant en Firestore (ej. `["RIVER", "ESCUELA_RIVER"]`).

### Despliegue

```bash
npm run build
# Deploy a Firebase App Hosting / Cloud Run / Vercel
firebase deploy
```

El webhook debe estar accesible en `https://tu-dominio/api/whatsapp/webhook`.

### Tests

```bash
npm run test        # una vez
npm run test:watch  # modo watch
```

### Setup inicial Firestore

Para activar el router, creá documentos en Firestore:

**1. Tenant (ej. HeartLink)** en `tenants/heartlink`:
```json
{
  "name": "HeartLink",
  "status": "active",
  "referralTokens": ["HEARTLINK", "HEART"],
  "webhookUrl": "https://heartlink--heartlink-f4ftq.us-central1.hosted.app/api/whatsapp/incoming",
  "internalSecret": "heartlink_internal_2026"
}
```

**2. Membresía de usuario** en `user_memberships/5491112345678` (phone_sanitized: reemplazar `+` y espacios por `_`):
```json
{
  "phone": "5491112345678",
  "tenantIds": ["heartlink"],
  "updatedAt": "<timestamp>"
}
```

Si el usuario tiene varios tenants: `"tenantIds": ["heartlink", "nautica", "river"]`.

### Consideraciones de cumplimiento

1. **No responder a no registrados** → Cumple políticas de WhatsApp (anti-spam)
2. **Límite de intentos** → Máx 2 reintentos en ask_choice, luego `silent_or_handoff`
3. **Idempotencia** → `claimInboundMessage` guarda en `wa_messages` al recibir; si ya existe, cortar (200 OK sin procesar)
4. **200 OK en < 5 segundos** → Procesamiento inline; para cargas altas considerar cola (Cloud Tasks)
5. **TTL** → wa_sessions 24h, wa_pending_choices 10 min, wa_last_tenant 30 días lógico

---

## Getting Started

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

## Learn More

- [Next.js Documentation](https://nextjs.org/docs)
- [WhatsApp Cloud API](https://developers.facebook.com/docs/whatsapp/cloud-api)
