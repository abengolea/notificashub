# Pedido a Náutica: completar integración WhatsApp

**Para:** Equipo Náutica / Marina del Yaguarón  
**De:** NotificasHub  
**Fecha:** 2026-03  

---

## Contexto

NotificasHub ya funciona como router de WhatsApp: cuando un usuario escribe, recibe una lista para elegir entre HeartLink y Marina del Yaguarón. Al elegir **Marina del Yaguarón**, NotificasHub reenvía el mensaje al webhook de Náutica, pero el chat queda sin respuesta.

---

## Lo que necesitamos de Náutica

### 1. Endpoint que reciba mensajes

Que exista y responda un endpoint tipo:

```
POST https://nauticadmin--nauticadmin.us-east4.hosted.app/api/whatsapp/incoming
```

(O la URL donde esté desplegado nauticadmin.)

### 2. Formato del payload que enviamos

Cada vez que un usuario envía un mensaje y eligió Marina del Yaguarón, hacemos:

```http
POST {webhookUrl}
Content-Type: application/json
x-internal-token: {internalSecret del tenant}

{
  "message": {
    "id": "wamid.xxx",
    "from": "5493364645357",
    "timestamp": "1234567890",
    "type": "text",
    "text": { "body": "Hola, quiero info de amarres" }
  },
  "from": "5493364645357",
  "contactName": "Juan Pérez",
  "messageId": "wamid.xxx",
  "timestamp": "1234567890"
}
```

### 3. Validación de seguridad

El endpoint **debe** validar el header `x-internal-token` contra el `INTERNAL_SECRET` configurado en Náutica. Si no coincide, rechazar con 401.

### 4. Responder al usuario

Después de procesar el mensaje, Náutica debe **enviar una respuesta** al usuario por WhatsApp. Hoy el chat queda “muerto” porque no hay respuesta.

Para eso hay dos alternativas:

- **Opción A (implementada):** NotificasHub expone `POST /api/whatsapp/send`. Ver sección "Endpoint para enviar respuestas" más abajo.
- **Opción B:** Otra forma que ya tenga Náutica de enviar respuestas (p.ej. otro sistema de mensajería o integración).

---

## Endpoint para enviar respuestas (Opción A)

NotificasHub expone `POST {NOTIFICASHUB_URL}/api/whatsapp/send` para que Náutica envíe mensajes al usuario.

```http
POST https://notificashub--studio-3864746689-59018.us-east4.hosted.app/api/whatsapp/send
Content-Type: application/json
x-internal-token: {INTERNAL_SECRET del tenant}

{
  "to": "5493364645357",
  "text": "Hola Juan! Somos Marina del Yaguarón...",
  "tenantId": "WZAf1Mw08Uq047wneIxI"
}
```

| Campo     | Requerido | Descripción |
|-----------|-----------|-------------|
| `to`      | Sí        | Teléfono del destinatario (también acepta `phone`, `from`) |
| `text`    | Sí        | Mensaje a enviar (también acepta `message`) |
| `tenantId`| No        | ID del tenant; si no se envía, se infiere por el token |

Respuesta: `{ ok: true, sent: true }` o `{ ok: false, error: "..." }`.

### 5. Documentos, imágenes y videos

Para mensajes de tipo `document` (PDF), `image` o `video`, NotificasHub descarga el archivo de Meta y agrega al payload:

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `documentBase64` | string | Base64 del PDF (solo si `message.type === "document"`) |
| `imageBase64` | string | Base64 de la imagen (solo si `message.type === "image"`) |
| `videoBase64` | string | Base64 del video (solo si `message.type === "video"`) |
| `documentMimeType` | string | Ej. `application/pdf` |
| `documentFilename` | string | Nombre del archivo si Meta lo envía |
| `videoMimeType` | string | Ej. `video/mp4` |

NauticAdmin puede usar `*Base64` para procesar comprobantes (PDF), fotos o videos.

### 6. Variables de entorno en Náutica

| Variable         | Descripción                                                |
|------------------|------------------------------------------------------------|
| `NOTIFICASHUB_URL` | `https://notificashub--studio-3864746689-59018.us-east4.hosted.app` |
| `INTERNAL_SECRET` | El secret del tenant de Marina del Yaguarón (lo da `npm run setup-tenant-nautica`) |

---

## Resumen del pedido

1. Endpoint `POST /api/whatsapp/incoming` (o equivalente) que reciba el payload descrito arriba.
2. Validación de `x-internal-token` contra `INTERNAL_SECRET`.
3. Lógica para procesar el mensaje y devolver una respuesta al usuario (coordinando con NotificasHub cómo enviarla).
4. `webhookUrl` y `internalSecret` correctos en el tenant de Firestore (NotificasHub).

---

## Contacto

Para dudas sobre el payload o el flujo: [tu contacto]
