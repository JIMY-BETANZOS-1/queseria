Lee `CLAUDE.md` completo y luego haz SOLO la Fase 0 (base de datos y estructura). No empieces backend, web ni móvil.

1. Crea la estructura:
   ```
   db/ (schema.sql, seed.sql, tests/escenarios.sql, scripts/)
   backend/  web/  mobile/   (carpetas vacías con un README.md de una línea)
   docs/     (pantallas.md)
   .gitignore  .env.example  README.md
   ```
   Los archivos `schema.sql` y `escenarios.sql` ya están en la raíz de esta carpeta: muévelos a `db/` y `db/tests/`
   SIN modificar su contenido.
2. Inicializa git (rama `main`) y haz un primer commit.
3. Crea scripts PowerShell en `db/scripts/`: `crear-bd.ps1` (borra y crea la base `queseria`, carga schema.sql y seed.sql),
   `correr-pruebas.ps1` (recrea una base temporal `queseria_test`, carga schema.sql y ejecuta escenarios.sql,
   mostrando PASS/FAIL), usando `psql` y variables de `.env` (host, puerto, usuario, contraseña).
4. Crea `db/seed.sql` con datos de EJEMPLO (márcalos con `-- EJEMPLO`): 1 admin (correo y contraseña de prueba con hash bcrypt),
   2 acopiadores con color y vehículo distintos, 1 analista, 3 rutas con acopiador asignado, 15 productores repartidos
   en las rutas (nombres realistas de Puno), 2 productores externos, 8 insumos con stock inicial y costo,
   composición de las 4 recetas ya sembradas (rendimiento por 100 L, vida útil, insumos) y 2 semanas de recolecciones de ejemplo.
   El seed debe cargar sin errores respetando todos los triggers del esquema.
5. Ejecuta `crear-bd.ps1` y `correr-pruebas.ps1`. Debe dar 89 PASS y 0 FAIL. Si algo falla, no lo "arregles" cambiando el esquema: reporta.
6. Escribe `docs/pantallas.md`: lista de pantallas de la web admin, de la app del acopiador y de la app del analista,
   indicando para cada una qué tabla o vista de la base consume (el esquema tiene al inicio el mapa pantalla → objetos).
7. Termina con un resumen: qué se creó, resultado de las pruebas y qué sigue (Fase 1: backend).
