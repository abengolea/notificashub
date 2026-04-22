# Setup definitivo — HeartLink + Náutica en NotificasHub

## Flujo en 3 pasos

### Paso 1: Configurar tenant Náutica (una vez)

```bash
npm run setup-nautica-definitivo -- --webhook "https://TU-NAUTICADMIN-URL/api/whatsapp/incoming"
```

Reemplazá `TU-NAUTICADMIN-URL` por la URL real (ej. `nauticadmin-xxx.web.app` o tu dominio).

**Salida:** El script muestra el `INTERNAL_SECRET`. Copiarlo en nauticadmin.

---

### Paso 2: Configurar nauticadmin

En `.env.local` de nauticadmin:

```
NOTIFICASHUB_URL=https://notificashub--studio-3864746689-59018.us-east4.hosted.app
INTERNAL_SECRET=<el que mostró el script>
```

Nauticadmin debe tener un endpoint que reciba POST en la URL que pasaste en `--webhook`, con header `x-internal-token` igual al INTERNAL_SECRET.

---

### Paso 3: Agregar usuarios a ambos tenants

```bash
npm run add-user-to-tenants -- 5493364645357 heartlink WZAf1Mw08Uq047wneIxI
```

(O el teléfono que corresponda.)

---

## Verificar que todo esté bien

```bash
npm run verificar-setup
```

Debe indicar que tenants tienen webhookUrl e internalSecret.

---

## Qué hace cada script

| Script | Uso |
|--------|-----|
| `setup-nautica-definitivo` | Crea tenant con webhookUrl + internalSecret (obligatorio --webhook) |
| `verificar-setup` | Comprueba que la config esté completa |
| `add-user-to-tenants` | Agrega usuario a varios tenants (sin API) |
| `debug-phone` | Revisa user_memberships de un teléfono |

---

## Requisitos de nauticadmin

1. Endpoint POST (ej. `/api/whatsapp/incoming`) que reciba:
   - Header `x-internal-token`: mismo valor que INTERNAL_SECRET del tenant
   - Body: `{ message, from, contactName, messageId, timestamp }`

2. Variables de entorno: `NOTIFICASHUB_URL`, `INTERNAL_SECRET`

3. Al crear usuario: llamar `POST /api/register-user` con `tenantId: "WZAf1Mw08Uq047wneIxI"`

---

## Lógica multi-tenant (ya implementada)

- Usuario con 1 tenant → mensaje va directo a esa app
- Usuario con 2+ tenants → lista "¿Por cuál servicio consultás?" → elige → mensaje va a la app elegida

No usa `wa_sessions` ni `wa_last_tenant`; la decisión viene de `user_memberships`.
