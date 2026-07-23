// Content script: SIFERE WEB (carga de CM05). Los navegadores no permiten que JS rellene un
// <input type="file"> con un archivo arbitrario por seguridad, así que esto NO sube el archivo
// solo: resalta el control de carga y avisa qué archivo hay que elegir (el que bajaste con el
// botón "Descargar CM05" del popup). Falta confirmar el selector real contra la página — ver
// plan "fase 0".

(function () {
  const UPLOAD_HINTS = ["seleccionar archivo", "examinar", "cargar archivo", "adjuntar", "subir archivo"];

  function findUploadControl() {
    const fileInput = document.querySelector('input[type="file"]');
    if (fileInput) return fileInput;

    const candidates = Array.from(document.querySelectorAll("button, a, label, input[type=button]"));
    return (
      candidates.find((el) => {
        const text = window.NhCommon.normalizeHeader(el.textContent || el.value || "");
        return UPLOAD_HINTS.some((hint) => text.includes(hint));
      }) || null
    );
  }

  function showBanner(target) {
    if (document.getElementById("nh-sifere-banner")) return;

    const banner = document.createElement("div");
    banner.id = "nh-sifere-banner";
    banner.textContent = "NotificasHub: subí acá el CM05 que descargaste desde el popup de la extensión.";
    Object.assign(banner.style, {
      position: "fixed",
      top: "12px",
      right: "12px",
      zIndex: 999999,
      background: "#059669",
      color: "white",
      padding: "10px 14px",
      borderRadius: "8px",
      fontFamily: "system-ui, sans-serif",
      fontSize: "13px",
      boxShadow: "0 2px 10px rgba(0,0,0,.25)",
      maxWidth: "280px",
    });
    document.body.appendChild(banner);

    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "center" });
      target.style.outline = "3px solid #059669";
      target.style.outlineOffset = "2px";
    }
  }

  function scan() {
    const control = findUploadControl();
    if (control) showBanner(control);
    return { found: !!control };
  }

  window.NhCommon.registerScanHandler("sifere_status", scan);

  // También se ejecuta solo al cargar la página, sin esperar que el usuario abra el popup.
  window.addEventListener("load", () => {
    const control = findUploadControl();
    if (control) showBanner(control);
  });
})();
