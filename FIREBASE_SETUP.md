# Configuración de Firebase

## Paso 1: Configurar Firestore

1. Ve a [Firebase Console](https://console.firebase.google.com)
2. Selecciona tu proyecto existente
3. En el menú lateral, ve a **Build** → **Firestore Database**
4. Si no está creada, clic en **Create database**
5. Selecciona **Start in test mode** (para desarrollo)
6. Elige la ubicación más cercana

## Paso 2: Obtener credenciales

1. En Firebase Console, ve a **Project Settings** (⚙️ en el menú lateral)
2. Scroll hasta **Your apps**
3. Si no tienes una app web, clic en el icono **</>** (Web)
4. Registra la app con nombre "CaboHealth"
5. Copia las credenciales que aparecen:

```javascript
const firebaseConfig = {
  apiKey: "xxx",
  authDomain: "xxx.firebaseapp.com",
  projectId: "xxx",
  storageBucket: "xxx.appspot.com",
  messagingSenderId: "xxx",
  appId: "xxx"
};
```

## Paso 3: Actualizar el código

Abre `services/firebase.ts` y reemplaza los valores:

```typescript
const firebaseConfig = {
  apiKey: "TU_API_KEY_REAL",
  authDomain: "TU_PROJECT.firebaseapp.com",
  projectId: "TU_PROJECT_ID",
  // ... resto de credenciales
};
```

## Paso 4: Crear datos de prueba

### Opción A: Desde Firebase Console (Recomendado)

1. Ve a **Firestore Database**
2. Clic en **Start collection**
3. Collection ID: `cabohealth_apps`
4. Agrega documentos con estos campos:

| Campo | Tipo | Ejemplo |
|-------|------|---------|
| name | string | "Calculadora" |
| description | string | "Calcula macros" |
| url | string | "https://example.com" |
| icon | string | "🧮" |
| color | string | "#E3F2FD" |
| order | number | 1 |
| isActive | boolean | true |
| isNew | boolean | false |
| createdAt | timestamp | (auto) |
| updatedAt | timestamp | (auto) |

### Opción B: Usando el script

1. Actualiza las credenciales en `scripts/seed-firestore.ts`
2. Ejecuta:
```bash
npx ts-node scripts/seed-firestore.ts
```

## Paso 5: Reglas de seguridad (opcional para producción)

Para desarrollo, las reglas de "test mode" están bien.
Para producción, copia el contenido de `firestore.rules` a Firebase Console → Firestore → Rules.

## Verificación

La app debería:
1. Cargar las apps desde Firestore
2. Mostrarlas en el grid (Fase 3)
3. Funcionar offline con caché (después de primera carga)

---

## Datos de ejemplo para copiar manualmente

Si prefieres copiar manualmente, aquí están los datos:

### App 1
- name: `Analizador de Cosméticos`
- description: `Analiza ingredientes de productos`
- url: `https://incidecoder.com`
- icon: `💄`
- color: `#FFE4E1`
- order: `1`
- isActive: `true`
- isNew: `false`

### App 2
- name: `Calculadora Nutricional`
- description: `Calcula macros y calorías`
- url: `https://www.fatsecret.com`
- icon: `🥗`
- color: `#E8F5E9`
- order: `2`
- isActive: `true`
- isNew: `false`

### App 3
- name: `Generador de Paletas`
- description: `Crea combinaciones de colores`
- url: `https://coolors.co`
- icon: `🎨`
- color: `#E3F2FD`
- order: `3`
- isActive: `true`
- isNew: `true`

### App 4
- name: `Conversor de Unidades`
- description: `Convierte medidas fácilmente`
- url: `https://www.unitconverters.net`
- icon: `📐`
- color: `#FFF3E0`
- order: `4`
- isActive: `true`
- isNew: `false`

### App 5
- name: `Notas Rápidas`
- description: `Toma notas al instante`
- url: `https://privnote.com`
- icon: `📝`
- color: `#F3E5F5`
- order: `5`
- isActive: `true`
- isNew: `false`

### App 6
- name: `Clima`
- description: `Pronóstico del tiempo`
- url: `https://weather.com`
- icon: `🌤️`
- color: `#E0F7FA`
- order: `6`
- isActive: `true`
- isNew: `false`
