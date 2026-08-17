# CaboHealth Minimal Public v1 — Especificación de corte para App Store

**Fecha:** 2026-08-16

**Estado:** Aprobado por el usuario

**Reemplaza para v1:** Las decisiones de acceso de clientes, administración dentro de iOS y tercer módulo descritas en `2026-08-16-cabohealth-catalog-platform-design.md`. Ese documento se conserva como visión futura, no como alcance del primer lanzamiento.

## 1. Decisión de producto

La primera versión aprobable de CaboHealth será una modificación incremental de la aplicación Expo existente. No se crea otra app, no cambia el bundle ID, no cambia el proyecto EAS/App Store Connect y no se desecha la identidad visual ya aprobada.

El flujo de v1 es:

1. Portada A4 en la primera instalación, con el wordmark CaboHealth, fondo molecular, tagline y entrada inmediata.
2. Catálogo nativo editorial con exactamente dos miniapps públicas.
3. Apertura de cada miniapp en un WebView restringido o mediante su Universal Link canónico.
4. Navegación nativa a Apps, Saved y Settings.

## 2. Alcance duro del lanzamiento

Las únicas miniapps de v1 son:

| Slug | Nombre | Acceso | URL canónica |
| --- | --- | --- | --- |
| `healthy-recipes` | Healthy Recipes | Público | `https://cabohealth.org/apps/healthy-recipes/` |
| `clinic-guide` | CaboHealth Clinic Guide | Público | `https://cabohealth.org/apps/clinic-guide/` |

Los checks de compilación fallan si catálogo, allowlist o AASA contienen un tercer slug. Review Notes y screenshots se verifican en un gate de submission posterior a su creación, antes de `Add for Review`.

No se incluyen en iOS v1:

- Client Resources, Sleep Lab, Gut Health, Service Hub, AI Cosmetic Scan ni Health Advisor;
- código de cliente, login, cuenta técnica, biometría, Face ID, IAP o CTA de compra;
- panel administrativo, Staff Sign In, gesto secreto o PIN;
- PHI, datos de pacientes, formularios clínicos, IA, diagnóstico, dosificación o tratamiento personalizado;
- analytics, publicidad, tracking o permisos sensibles;
- activación remota de módulos nuevos después de la aprobación.

El panel administrativo y el acceso de clientes permanecen en el historial de Git y en la visión futura. No están alcanzables ni empaquetados en el binario consumidor de v1.

## 3. Reutilización obligatoria

La implementación parte del proyecto existente y conserva:

- `com.cabohealth.app`, el slug `cabohealth`, el Apple App ID y el proyecto EAS actual;
- el árbol Expo Router, modificando rutas en lugar de crear otro proyecto;
- `ThemeContext`, la paleta, layout, iconos, `AppCard`, estados de error/carga y almacenamiento local no sensible;
- `AnimatedMolecules` como base de la portada A4, corrigiendo ciclo de vida y Reduce Motion;
- el WebView actual como base, agregando una política estricta de navegación;
- los logos, iconos y splash existentes, incorporando localmente el wordmark azul aprobado.

Las funciones retiradas se eliminan de la rama de release, pero siguen recuperables en commits anteriores.

## 4. Valor nativo y experiencia

El shell no se presenta como tienda, marketplace, instalador ni colección genérica de links. Se presenta como un portal de salud curado por CaboHealth.

### 4.1 Portada A4

- Se muestra sólo en primera instalación y al elegir “Ver introducción nuevamente”.
- El CTA funciona inmediatamente; el avance automático ocurre aproximadamente a los 1.6 segundos.
- El wordmark es un asset local y siempre permanece visible.
- Voz de movimiento: serena y expresiva, reservada para una experiencia rara de onboarding.
- Con Reduce Motion, la composición aparece completa y estática sin espera.
- La animación se pausa al perder foco, pasar a background o quedar fuera de pantalla, y libera sus loops al desmontar.

### 4.2 Catálogo nativo

- Muestra las dos tarjetas en el primer viewport, sin login ni pasos intermedios.
- Cada tarjeta incluye nombre, resumen editorial, estado público, edad, datos/permisos, fuente y fecha de última revisión.
- Un control visible permite guardar o quitar cada módulo; no depende de long press.
- Saved muestra sólo miniapps guardadas. Los favoritos de recetas permanecen dentro de Healthy Recipes y no usan puente JS nativo.
- El shell incluye utilidad nativa/offline sustantiva ligada a los dos módulos: explorador de recetas y checklist de preparación de visita. No depende de que un WebView cargue para entregar todo el valor básico.
- Inglés y español tienen paridad; inglés es fallback.

### 4.3 Settings

- Idioma, tema, preferencia de movimiento, hápticos y reproducción de la introducción.
- Privacy, Terms, Support y Report Content con URLs públicas estables.
- Sin cuenta, código, biometría, logout ni acceso de personal.

## 5. Miniapps públicas

### 5.1 Healthy Recipes

Experiencia HTML/CSS/JavaScript pública y bilingüe con al menos doce recetas originales o con derechos verificables. Incluye búsqueda, filtros descriptivos, detalle, ingredientes, instrucciones, tiempo, porciones, alérgenos y favoritos locales.

No recomienda dietas según enfermedad ni afirma prevenir, diagnosticar o tratar. Incluye seguridad alimentaria, fuentes editoriales y el aviso de consultar a un profesional antes de tomar decisiones médicas.

### 5.2 CaboHealth Clinic Guide

Experiencia pública y bilingüe con preparación de visita, qué llevar, accesibilidad, idiomas, contacto, ubicación, horario confirmado y orientación de emergencia. Puede resumir servicios públicos del sitio oficial con lenguaje neutral, sin reproducir claims promocionales de tratamiento.

No recibe nombre, síntomas, resultados, expediente, cita ni información clínica. Los enlaces de mapa, llamada, correo o WhatsApp se abren externamente sólo desde acciones explícitas.

### 5.3 Implementación compartida

Las dos rutas pueden compartir estilos, logo, motion controller y componentes web. No se requieren dos frameworks o dos repositorios. Se generan como artefactos estáticos separados bajo `public_html/apps/` y no modifican el tema WordPress.

El contenido permanece visible sin JavaScript. CSS controla microinteracciones; Canvas se reserva para la constelación, con frame rate y DPR limitados, pausa visible, `prefers-reduced-motion`, `Save-Data`, visibilidad de documento y cleanup.

## 6. Seguridad de navegación

El catálogo es inmutable dentro del release. No consume Firestore ni una lista remota.

La política de navegación acepta dentro del WebView únicamente:

- HTTPS;
- host exacto `cabohealth.org`;
- el prefijo exacto de la miniapp seleccionada.

El WebView no incluye `onMessage`, JavaScript inyectado, puente nativo, acceso a archivos, mixed content, ventanas automáticas ni APIs/permisos nativos. Toda solicitud pasa primero por una política síncrona cerrada; redirects y popups se bloquean. Privacy, Terms, Support y Report Content, además de mapa, teléfono, correo y WhatsApp confirmados, usan una allowlist externa exacta y sólo se abren en el sistema después de un tap explícito. Los popups se bloquean incluso cuando apuntan a un destino permitido.

En iOS se limita WebKit a `WKAppBoundDomains` para `cabohealth.org`; esta defensa de dominio complementa, pero no reemplaza, la validación exacta de ruta. Las miniapps usan enlaces en la misma ventana para que el gesto llegue a la política verificable.

Cada miniapp se sirve con CSP estricta que limita scripts, estilos e imágenes a recursos propios y bloquea `connect-src`, frames, objetos, formularios, workers, fuentes y media remotos. La allowlist de navegación no se considera control suficiente para subrecursos.

El shell no entrega identificadores, locale, Saved, permisos ni datos personales a las miniapps.

## 7. Universal Links y hosting

El binario declara `applinks:cabohealth.org`. La ruta nativa `/apps/[slug]` resuelve contra el mismo catálogo y la misma política que un tap interno.

`/.well-known/apple-app-site-association` responde por HTTPS, sin redirect y con JSON válido. Sólo declara las dos rutas canónicas exactas que puede resolver `app/apps/[slug].tsx`:

- `/apps/healthy-recipes/`
- `/apps/clinic-guide/`

Las rutas públicas necesarias para el release son:

- `/apps/healthy-recipes/`
- `/apps/clinic-guide/`
- `/app/privacy/`
- `/app/terms/`
- `/app/support/`
- `/app/report-content/`
- `/.well-known/apple-app-site-association`

Se respalda el sitio y base de datos antes de desplegar. La publicación se hace en staging o carpeta versionada, se verifica, y luego se promueve con rollback preparado.

## 8. Privacidad y contenido

Las miniapps no tienen UGC, cuentas, compras, analytics ni datos de salud. Cada una muestra Privacy y Report Content. El hosting puede generar logs técnicos; la política declara proveedor, finalidad, retención y eliminación reales.

Todo contenido pasa revisión editorial previa. El equipo mantiene un procedimiento documentado para reportar, retirar y bloquear contenido abusivo o comprometido, además de rate limiting/WAF del hosting.

Antes del release debe retirarse del dominio y de cachés cualquier documento público que contenga datos de pacientes. Ningún archivo clínico puede quedar bajo un path indexable o relacionado con las miniapps.

## 9. Reglas de publicación

- Apple recibe exactamente el build probado en TestFlight.
- Screenshots, metadata, AASA, catálogo y Review Notes describen sólo las dos miniapps públicas.
- Review Notes explican ausencia de login, compras, UGC, datos personales/de salud, permisos y puente nativo, además del disclosure exacto de logs técnicos del hosting.
- El seller debe ser la entidad legal que presta CaboHealth o contar con dirección escrita de Apple que valide otra estructura.
- Un tercer módulo o cambio material requiere nueva versión, allowlist, AASA, QA y revisión; nunca se activa silenciosamente.

## 10. Criterio de terminado

El release está listo para enviarse sólo cuando:

- las pruebas automáticas rechazan un tercer slug y cualquier ruta/import legacy;
- ambas miniapps y todos sus links pasan QA móvil, bilingüe, accesible, offline/error y contenido;
- el WebView bloquea navegación no aprobada;
- AASA funciona en origen y CDN de Apple, y los Universal Links abren el build firmado;
- icono final 1024×1024 no tiene alpha;
- Privacy, Terms y Support coinciden con el build;
- no queda PHI público en el dominio;
- la clasificación calculada en el cuestionario vigente de App Store Connect está congelada en el release y ninguna miniapp la excede;
- el RC exacto pasa instalación limpia, actualización y TestFlight en iPhone físico.
