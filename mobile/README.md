# Móvil: app Android de campo (acopiador)

Kotlin + Jetpack Compose (Material 3) + Room (KSP) + WorkManager + Retrofit/kotlinx.serialization.
Offline-first. Contrato con la API: `docs/sincronizacion.md` (fuente de verdad).

## Requisitos
- Android Studio (usa su JDK: `C:\Program Files\Android\Android Studio\jbr`).
- SDK platform 36. `minSdk 26`. Celular de prueba: Realme C11 2021 (Android 11).
- `mobile/local.properties` (fuera de git), a partir de `local.properties.example`:
  - `api.base.url=http://IP_DE_TU_PC:8000/`. Debug acepta HTTP en la red local; release exige HTTPS.
  - La API ya escucha en la red local (`backend/scripts/dev.ps1` usa `--host 0.0.0.0`).

## Compilar y probar (PowerShell, desde `mobile/`)
```powershell
$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
.\gradlew.bat assembleDebug              # APK: app\build\outputs\apk\debug\app-debug.apk
.\gradlew.bat testDebugUnitTest          # firmador, cola/motor de sync, PIN local
.\gradlew.bat connectedDebugAndroidTest  # Room + Keystore en el celular conectado (adb)
```

## Estructura (`app/src/main/java/pe/queseria/campo`)
| Paquete | Qué hace |
|---|---|
| `firma/` | Cadena canónica v1, firma ECDSA P-256 (`Firmador`), formatos (`Formato`), clave del Keystore (`ClaveDispositivo`). |
| `seguridad/` | `Autenticador` (activación, PIN, token), `PinLocal` (ingreso sin red + bloqueo), `CajaFuerte` (AES-GCM con clave del Keystore). |
| `datos/local/` | Room: productores, rutas, estado de sanción, recolecciones (cola por `estado_sync`), meta (cursor de pull, última firma). |
| `datos/remoto/` | Retrofit (endpoints reales), DTOs y traducción de errores HTTP a mensajes (`ErrorApp`). |
| `registro/` | Armado y firma de la recolección (`ArmadoRecoleccion`), registro encadenado y alta de productor de campo (`Registrador`). |
| `sync/` | `MotorSync` (push por lotes + pull incremental), `SyncWorker` (WorkManager), `MiDia`. |

## Decisiones
- **Token y datos de sesión:** se cifran con AES-256-GCM, con la clave en Android Keystore, y se guardan
  en SharedPreferences privadas, excluidas del respaldo. No se usa `EncryptedSharedPreferences`
  porque `security-crypto` está deprecada y trae Tink, pesado para un celular con poca RAM.
- **Lo firmado se guarda como texto** (`"23.50"`, `"-15.614512"`, hora UTC en ms) y se envía tal cual:
  el JSON lleva exactamente los números que se firmaron (`NumeroExacto`).
- **Cola:** las filas `PENDIENTE` de `recoleccion`/`productor`. `creado`/`duplicado` → `SINCRONIZADO`;
  `rechazado` → `RECHAZADO` con motivo, se conserva y no se reenvía. Ante una falla de red queda
  `PENDIENTE` y WorkManager reintenta con espera exponencial. Solo se purga lo confirmado de hace más de 7 días.
- Huecos del contrato: ver "Observaciones de la app Android" en `docs/sincronizacion.md`.
