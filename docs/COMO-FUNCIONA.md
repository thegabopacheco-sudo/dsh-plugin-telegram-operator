# Cómo funciona dsh-plugin-telegram-operator

Operador de Telegram para DeepSeek Harness: consulta updates, envia mensajes y fotos por Bot API con lista blanca de chats, confirmacion, read-only y auditoria.

## Arquitectura

```
DSH ──MCP stdio──► server.mjs (bundle single-file)
                    └─ lógica local del plugin
```

## Herramientas reales

- `status`: Estado
- `updates`: Ver updates
- `send`: Enviar mensaje
- `photo`: Enviar foto

## Seguridad

- Lectura por defecto; acciones con `confirm:true`.
- Modo `read-only` por variable de entorno.
- Listas blancas cuando aplique.
- Auditoría en `<DSH_HOME>\cache\telegram-operator\audit.jsonl`.
- Rate limit de acciones.

## Verificación

Tests end-to-end con el cliente MCP oficial (`@modelcontextprotocol/client@2.2.0`)
y artefacto empaquetado (`npm pack` → `postinstall` → servidor desplegado).
