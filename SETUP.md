# Setup en tu máquina (Fer)

> Pasos para arrancar Project Memory MCP localmente y conectarlo a Claude Desktop. La primera vez, sigue del 1 al 6. Las siguientes veces: `git pull && npm install && npm run build`.

## 0. Prerrequisitos

- **Node.js 20+** instalado. Verifica: `node --version`.
- **git** instalado.
- **Claude Desktop** instalado.

Si no tienes Node: https://nodejs.org/ (descarga LTS).

## 1. Clonar/mover el proyecto a donde lo vayas a mantener

El proyecto ya está armado en la carpeta de Cowork. Muévelo (o cópialo) a donde quieras que viva, por ejemplo:

```bash
# Ejemplo, ajusta a tu gusto
mv "/Users/fer/CoworkFolder/Proyecto: Project Memory MCP" ~/code/project-memory-mcp
cd ~/code/project-memory-mcp
```

> No tiene que llamarse "project-memory-mcp" en el sistema de archivos, pero te va a ahorrar confusión.

## 2. Inicializar git y hacer el primer commit

```bash
cd ~/code/project-memory-mcp
git init -b main
git add .
git commit -m "chore: initial scaffolding and first working tool (get_project_context)"
```

Cuando estés listo para hacerlo público:

```bash
# En GitHub, crea un repo vacío llamado project-memory-mcp (sin README, sin .gitignore)
git remote add origin git@github.com:<tu-usuario>/project-memory-mcp.git
git push -u origin main
```

## 3. Instalar dependencias y compilar

```bash
npm install
npm run build
npm test            # sanity check: deben pasar 5/5
```

Si todo está en orden verás `5 passed`.

## 4. Anota la ruta absoluta al server

```bash
pwd
# Ejemplo: /Users/fer/code/project-memory-mcp
```

La ruta al ejecutable será:

```
/Users/fer/code/project-memory-mcp/dist/index.js
```

Cópiala — la vas a usar en el próximo paso.

## 5. Configurar Claude Desktop

Abre el archivo de configuración de Claude Desktop:

- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

Si no existe, créalo. Si existe y ya tienes otros MCP servers, solo agrega la nueva entrada dentro de `"mcpServers"`.

**Ejemplo completo:**

```json
{
  "mcpServers": {
    "project-memory": {
      "command": "node",
      "args": ["/Users/fer/code/project-memory-mcp/dist/index.js"]
    }
  }
}
```

> **Importante:** el `command` tiene que ser `node` (o la ruta absoluta a tu Node — `which node` te la da). El `args` debe ser la ruta **absoluta** al `dist/index.js` compilado.

## 6. Reiniciar Claude Desktop

- En macOS: menú "Claude" → Quit Claude (no alcanza con cerrar la ventana).
- En Windows: cierra desde la bandeja.

Luego vuelve a abrirlo. En el panel de MCP deberías ver `project-memory` listado. Si aparece un ⚠️, abre los logs:

- macOS: `~/Library/Logs/Claude/mcp-server-project-memory.log`
- Windows: `%APPDATA%\Claude\logs\mcp-server-project-memory.log`

## 7. Probarlo

Dentro de una conversación de Claude Desktop, pídele:

> Usa la herramienta `get_project_context` con path `/Users/fer/code/project-memory-mcp` y resume el proyecto.

Claude te debería devolver nombre, lenguajes detectados, top-level y estado de Git.

## Troubleshooting

- **`node: command not found` en Claude Desktop:** reemplaza `"command": "node"` por la ruta absoluta (`which node` → copia el resultado).
- **Server aparece rojo en el panel:** mira el log. 99% de las veces es JSON mal formado en `claude_desktop_config.json` o ruta equivocada a `dist/index.js`.
- **Todo parece bien pero no ves la tool:** cerraste Claude Desktop completamente antes de reabrir? El config sólo se lee al arrancar.
- **Más detalle:** `DEBUGGING.md` tiene un smoke test para correr el server sin Claude Desktop.
