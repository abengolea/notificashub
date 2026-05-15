# Setup Multi-Tenant (HeartLink + Náutica) — Solución definitiva

## Resumen del flujo

1. Usuario escribe por WhatsApp.
2. Si tiene **un solo tenant** → mensaje va directo a esa app.
3. Si tiene **varios tenants** → recibe lista "¿Por cuál servicio consultás?" → elige → mensajes van a esa app.

---

## Paso 1: Crear tenant Náutica en NotificasHub (una sola vez)

En Firestore debe existir `tenants/WZAf1Mw08Uq047wneIxI` con:
- `webhookUrl`: URL de nauticadmin donde NotificasHub reenvía mensajes (ej. `https://nauticadmin.../api/whatsapp/incoming`)
- `internalSecret`: para validar las requests entre NotificasHub y Náutica

```bash
# Crear/actualizar tenant con webhook de nauticadmin
npm run setup-tenant-nautica -- --webhook https://TU-NAUTICADMIN/app/api/whatsapp/incoming
```

O sin webhook (solo internalSecret), y agregar webhookUrl después en Firestore:

```bash
npm run setup-tenant-nautica
```

**Salida:** se muestra `INTERNAL_SECRET`. Copiarlo y configurarlo en Náutica (env var o config).

---

## Paso 2: Agregar usuario a ambos tenants

Sin pasar por la API (escritura directa a Firestore):

```bash
npm run add-user-to-tenants -- 5493364645357 heartlink WZAf1Mw08Uq047wneIxI
```

O si usás `nautica` como tenant ID:

```bash
npm run add-user-to-tenants -- 3364645357 heartlink nautica
```

(El teléfono se normaliza a 549...)

---

## Paso 3: Forzar la lista en el próximo mensaje (opcional)

Si el usuario ya tiene sesión/último tenant guardados:

```bash
npm run force-ask-choice -- 5493364645357
```

---

## Formato del teléfono

| Entrada           | NotificasHub usa |
|-------------------|------------------|
| 3364645357         | 5493364645357    |
| 5493364645357      | 5493364645357    |
| 549 33 646 45357   | 5493364645357    |

Meta envía `wa_id: 5493364645357`. El doc en `user_memberships` debe tener ID `5493364645357` (sin espacios, sin +).

---

## Configuración en cada app

### HeartLink

- `NOTIFICASHUB_URL`: `https://notificashub--studio-3864746689-59018.us-east4.hosted.app`
- `INTERNAL_SECRET`: `heartlink_internal_2026` (o el que tengas en tenants/heartlink)
- Al crear usuario: `POST /api/register-user` con `tenantId: "heartlink"`

### Náutica

- `NOTIFICASHUB_URL`: igual
- `INTERNAL_SECRET`: el que dio `setup-tenant-nautica`
- Al crear usuario: `POST /api/register-user` con `tenantId: "WZAf1Mw08Uq047wneIxI"` (o `nautica`)

---

## Diagnóstico

```bash
npm run debug-phone -- 3364645357
```

Muestra qué doc existe y qué `tenantIds` tiene.

---

## Checklist para nauticadmin

| Revisión | Dónde | Qué verificar |
|----------|-------|---------------|
| Tenant en Firestore | NotificasHub → Firestore → `tenants/WZAf1Mw08Uq047wneIxI` | `webhookUrl` apunta a nauticadmin, `internalSecret` configurado |
| Lógica multi-tenant | NotificasHub (`resolveTenant`) | Ya implementado: usuarios con 2+ tenants ven lista para elegir |
| user_memberships | NotificasHub → `user_memberships/5493364645357` | `tenantIds` incluye `heartlink` y `WZAf1Mw08Uq047wneIxI` |
| ENV en Náutica | nauticadmin `.env` | `NOTIFICASHUB_URL`, `INTERNAL_SECRET` (el de setup-tenant-nautica) |

---

## Colecciones Firestore

| Colección         | Uso |
|-------------------|-----|
| `tenants`         | Cada tenant: name, status, webhookUrl, internalSecret, referralTokens |
| `user_memberships`| phone (doc ID) → tenantIds[] |
| `wa_last_tenant`  | Último tenant elegido (se limpia con force-ask-choice) |
| `wa_sessions`     | Sesión activa por día (se limpia con force-ask-choice) |
