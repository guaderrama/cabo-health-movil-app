# CaboHealth implementation order

Los cuatro planes son independientes como documentos, pero no deben ejecutarse completos en orden arbitrario. Esta es la secuencia canónica:

1. **App Store preflight:** App Store Release Task 0. Resolver historial, seller legal y modelo comercial antes de construir acceso protegido.
2. **Foundation gate:** Native Shell Tasks 1–2. Produce toolchain, tests y `packages/contracts`.
3. **Parallel local tracks:**
   - Native Shell Tasks 3–5 contra fakes.
   - Secure Backend Tasks 1–5 en Emulator Suite.
   - Miniapps/Hosting Task 0 y Tasks 1–4 localmente.
4. **Private-access integration:** Backend Tasks 6–8, Miniapps Task 5 y Native Tasks 6–7. Los fixtures TS/PHP deben ser idénticos.
5. **Product completion:** Native Task 8, Miniapps Task 6 y Backend Task 9. Ejecutar todas las suites desde instalaciones limpias.
6. **Staging and non-RC integration:** iniciar Backend Task 10 hasta desplegar `publicApi`/`brokerApi` staging; ejecutar Miniapps Task 7 en modo staging y Task 8 hasta desplegar/verificar `/apps-staging/`; reanudar Backend Task 10 para App Check físico, migración, reglas cerradas y el build interno descartable.
7. **Reserve final App Store identity:** App Store Release Task 1 consulta el máximo después del build interno y committea `releaseId` + versión/build reservados.
8. **Production web/backend binding:** reejecutar Miniapps Task 7 en modo production; iniciar Task 9 hasta activación + smoke público; ejecutar Backend Task 11 para publicar ese manifest, crear `candidate` y provisionar demos; reanudar Miniapps Task 9 para E2E/rollback/AASA; finalizar App Store Task 2 para congelar el scope.
9. **Final App Store program:** ejecutar App Store Release Tasks 3–11. Verificar, congelar el worktree detached, crear un RC nuevo, probarlo en TestFlight y sólo entonces enviarlo.

Reglas de coordinación:

- Una tarea no consume un archivo o endpoint que su productor aún no haya committeado y verificado.
- Los agentes pueden trabajar en paralelo sólo si sus conjuntos de archivos no se superponen.
- `app.config.ts` pertenece al plan nativo; `packages/contracts` pertenece al foundation gate; `release.json` pertenece al plan App Store.
- Native Task 1 crea el schema de topología; Backend Task 1 descubre los IDs reales y crea `config/environment-topology.json`. Desde entonces Expo, Functions, PHP y release verification consumen ese archivo exacto; ningún flujo sustituye URLs mediante variables arbitrarias.
- Cambios a contratos obligan a ejecutar sus tests y todos los consumidores antes de continuar.
- `web-hosting/.../release-manifest.json` es el artefacto canónico de un release web; `published_catalog/current` guarda su forma normalizada/hash y la allowlist nativa sólo impone el límite superior. Release verification compara los tres.
- Cualquier cambio funcional después del freeze invalida el RC y vuelve al gate correspondiente.
- El SHA fuente del RC es el HEAD de un worktree detached limpio usado por EAS. El worktree principal puede avanzar al committear release/provenance y no se compara su HEAD con ese SHA.
- `reviewSandboxAdmin` vive en el contexto Firebase Auth normal y obtiene `scope: reviewSandbox` sólo del servidor; no existe selector de ambiente en el portal ni acceso de esa cuenta a IDs/repositorios de producción.
