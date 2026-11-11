# dsh-plugin-telegram-operator — Telegram Operator

Operador de Telegram para DeepSeek Harness: consulta updates, envia mensajes y fotos por Bot API con lista blanca de chats, confirmacion, read-only y auditoria.

## Tools

| Tool | Qué hace |
|---|---|
| `status` | Estado |
| `updates` | Ver updates |
| `send` | Enviar mensaje |
| `photo` | Enviar foto |

## Instalación

Desde **DSH → Settings → Plugins** instala `github:thegabopacheco-sudo/dsh-plugin-telegram-operator` y permite el script de instalación.

```
dsh plugin --profile <perfil> add github:thegabopacheco-sudo/dsh-plugin-telegram-operator
```

## Seguridad

- Lectura por defecto; escritura solo con `confirm:true` y pedido explícito.
- `DSH_TELEGRAM_OPERATOR_MODE=read-only` desactiva acciones.
- Listas blancas y auditoría en `<DSH_HOME>\cache\telegram-operator\audit.jsonl`.

## Licencia

MIT © thegabopacheco-sudo
