# Fix: WHATSAPP_ACCESS_TOKEN y error 401 "Cannot parse access token"

---

## 1. Estado actual en apphosting.yaml

La variable **ya usa Secret Manager**:

```yaml
- variable: WHATSAPP_ACCESS_TOKEN
  secret: whatsapp-access-token
  availability:
    - RUNTIME
```

No hace falta cambiar a Secret Manager: ya está configurado así.

---

## 2. Problema

Meta devuelve 401 "Cannot parse access token" pero el token es válido al probarlo directo. Eso suele indicar que el valor que llega al runtime tiene:

- Espacios al inicio o al final
- Salto de línea al final (muy común al pegar en formularios web)
- Caracteres invisibles (BOM, etc.)

---

## 3. Solución: nueva versión del secret con valor limpio

### Paso 1: Obtener el token de Meta

1. [developers.facebook.com](https://developers.facebook.com) → tu app → WhatsApp → API Setup
2. Copiar el **Access token** (o generar uno con System User)

### Paso 2: Limpiar el valor antes de pegarlo

En **Notepad** o **Bloc de notas**:

1. Pegar el token
2. Verificar que **no haya**:
   - Espacios antes o después
   - Línea en blanco al final
3. `Ctrl+A` → `Ctrl+C` para copiar de nuevo (valor limpio)

### Paso 3: Crear nueva versión en Google Cloud Secret Manager

1. Ir a [console.cloud.google.com/security/secret-manager](https://console.cloud.google.com/security/secret-manager)
2. Seleccionar proyecto **studio-3864746689-59018**
3. Buscar el secret **whatsapp-access-token** → clic
4. Pestaña **Versions** → **+ New version**
5. En **Secret value**:
   - Pegar **solo** el token (el que limpiaste en Notepad)
   - No agregar nada más (ni espacios, ni Enter)
6. **Add new version**

La nueva versión pasa a ser "latest" y el próximo deploy la usará.

### Paso 4: Redeploy

Para que el backend tome el nuevo valor:

- **Firebase Console** → App Hosting → notificashub → **Rollouts** → **Create rollout** (o Redeploy)
- O un push a `main` si hay auto-deploy

---

## 4. Opcional: fijar versión en apphosting.yaml

Si creaste la versión 2 (o 3, etc.) y querés asegurarte de usar esa:

```yaml
- variable: WHATSAPP_ACCESS_TOKEN
  secret: whatsapp-access-token@2   # @2 = versión 2
  availability:
    - RUNTIME
```

Solo hace falta si querés versionado explícito; por defecto se usa "latest".

---

## 5. Alternativa: Firebase Console (variables de entorno)

Las variables en **Firebase Console** tienen prioridad sobre `apphosting.yaml`.

1. Firebase Console → App Hosting → notificashub → **Settings**
2. **Environment variables** → Add / Edit
3. Clave: `WHATSAPP_ACCESS_TOKEN`
4. Valor: pegar el token (con el mismo cuidado: sin espacios ni newlines)

Esto sobreescribe el valor del secret. Útil para probar si el problema está en Secret Manager o en el valor en sí.

---

## Resumen

| Qué | Acción |
|-----|--------|
| Config en apphosting.yaml | Ya usa Secret Manager |
| Valor del token | Crear nueva versión del secret con valor limpio |
| Dónde | Secret Manager → whatsapp-access-token → New version |
| Cómo pegar | Usar Notepad para quitar espacios/newlines antes de pegar |
| Después | Redeploy para aplicar el cambio |
