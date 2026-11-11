#!/usr/bin/env node
// dsh-plugin-telegram-operator — operador de Telegram por Bot API.
// Tools: status, updates, send, photo.

import path from 'node:path';
import os from 'node:os';
import { existsSync, mkdirSync, readFileSync, statSync, appendFileSync } from 'node:fs';
import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { z } from 'zod';

const VERSION = '0.1.0';
const DSH_HOME = (() => {
  const v = process.env.DSH_HOME && process.env.DSH_HOME.trim();
  return v || path.join(process.env.USERPROFILE || process.env.HOME || os.homedir(), '.dsh');
})();
const CONFIG_FILE = path.join(DSH_HOME, 'telegram-operator', 'config.json');
const CACHE_DIR = path.join(DSH_HOME, 'cache', 'telegram-operator');
const AUDIT_FILE = path.join(CACHE_DIR, 'audit.jsonl');
const API_BASE = (process.env.DSH_TELEGRAM_API_BASE || 'https://api.telegram.org').replace(/\/+$/, '');
const READ_ONLY = String(process.env.DSH_TELEGRAM_MODE || '').toLowerCase() === 'read-only';
const SEND_LIMIT = 10;
const SEND_WINDOW_MS = 60_000;
const log = (m) => process.stderr.write(`[telegram] ${m}\n`);

function loadConfig() {
  const defaults = { token: '', allowedChatIds: [], allowedPaths: [process.env.USERPROFILE || os.homedir()] };
  try { if (existsSync(CONFIG_FILE)) return { ...defaults, ...(JSON.parse(readFileSync(CONFIG_FILE, 'utf8')) || {}) }; } catch (e) { log(`config: ${e.message}`); }
  return defaults;
}
const tokenOf = (config) => (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_BOT_TOKEN.trim()) || String(config.token || '').trim();
function requireToken(config) { if (!tokenOf(config)) throw new Error(`falta el token del bot. Configura TELEGRAM_BOT_TOKEN o "token" en ${CONFIG_FILE}`); }
function audit(entry) { try { mkdirSync(CACHE_DIR, { recursive: true }); appendFileSync(AUDIT_FILE, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n'); } catch { /* best effort */ } }

async function api(config, method, payload, rawForm = null) {
  requireToken(config);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const options = { method: 'POST', signal: controller.signal };
    if (rawForm) options.body = rawForm;
    else { options.headers = { 'content-type': 'application/json' }; options.body = JSON.stringify(payload || {}); }
    const response = await fetch(`${API_BASE}/bot${tokenOf(config)}/${method}`, options);
    const data = await response.json().catch(() => null);
    if (!response.ok || !data?.ok) throw new Error(`Telegram ${method}: ${data?.description || `HTTP ${response.status}`}`);
    return data.result;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('Telegram timeout');
    throw error;
  } finally { clearTimeout(timer); }
}
function ensureChatAllowed(config, chatId) {
  const list = (config.allowedChatIds || []).map((value) => String(value));
  if (list.length === 0) return;
  if (!list.includes(String(chatId))) throw new Error(`chat no permitido: ${chatId}. Lista blanca: ${list.join(', ')}`);
}
function ensureAllowedPath(config, filePath) {
  const absolute = path.resolve(filePath);
  const lower = absolute.toLowerCase();
  const ok = (config.allowedPaths || []).some((root) => {
    const r = path.resolve(root).toLowerCase();
    return lower === r || lower.startsWith(r + path.sep);
  });
  if (!ok) throw new Error(`ruta no permitida: ${absolute}. allowedPaths: ${(config.allowedPaths || []).join(', ')}`);
  return absolute;
}
const sendTimestamps = [];
function checkRate() {
  const now = Date.now();
  while (sendTimestamps.length && now - sendTimestamps[0] > SEND_WINDOW_MS) sendTimestamps.shift();
  if (sendTimestamps.length >= SEND_LIMIT) throw new Error(`límite de envíos (${SEND_LIMIT}/minuto)`);
  sendTimestamps.push(now);
}
function textResult(t) { return { content: [{ type: 'text', text: t }] }; }
function assertWritable() { if (READ_ONLY) throw new Error('modo read-only: envíos deshabilitados'); }

function buildInstructions() {
  return [
    'Telegram Operator: consulta y envía mensajes por la Bot API de Telegram.',
    '',
    `Config: ${CONFIG_FILE}`,
    '',
    'Herramientas: status, updates, send, photo.',
    '',
    'Reglas:',
    '- send/photo requieren confirm:true y pedido explícito del usuario; respeta allowedChatIds.',
    '- Nunca muestres el token ni lo escribas en logs.',
    '- No inventes mensajes ni chats: usa los ids que devuelve updates.',
    '- No envíes spam ni mensajes masivos sin confirmación.',
  ].join('\n');
}

function buildServer() {
  const server = new McpServer({ name: 'dsh-plugin-telegram-operator', version: VERSION }, { capabilities: { tools: {} }, instructions: buildInstructions() });

  server.registerTool(
    'status',
    { title: 'Estado', description: 'Bot (sin token), chats permitidos y modo.', inputSchema: z.object({}) },
    async () => {
      const config = loadConfig();
      const lines = [`Modo: ${READ_ONLY ? 'read-only' : 'normal'}`, `Config: ${CONFIG_FILE}`, `Token: ${tokenOf(config) ? 'configurado' : 'NO configurado'}`, `Chats permitidos: ${(config.allowedChatIds || []).join(', ') || 'todos (solo con confirmación)'}`];
      if (tokenOf(config)) {
        try { const me = await api(config, 'getMe', {}); lines.push(`Bot: @${me.username} (id ${me.id})`); }
        catch (error) { lines.push(`No se pudo consultar la API: ${error.message}`); }
      }
      return textResult(lines.join('\n'));
    },
  );

  server.registerTool(
    'updates',
    { title: 'Ver updates', description: 'Muestra los mensajes recientes recibidos por el bot.', inputSchema: z.object({ limit: z.number().int().min(1).max(50).optional() }) },
    async (args) => {
      const config = loadConfig();
      const updates = await api(config, 'getUpdates', { limit: args.limit ?? 10, timeout: 0 });
      if (!Array.isArray(updates) || updates.length === 0) return textResult('Sin updates recientes.');
      return textResult(updates.map((update) => {
        const message = update.message || update.edited_message || update.channel_post || {};
        const chat = message.chat || {};
        const from = message.from?.username || message.from?.first_name || 'desconocido';
        const who = chat.username ? `@${chat.username}` : (chat.title || chat.id);
        return `[update ${update.update_id}] ${who} · ${from}: ${String(message.text || '(sin texto)').replace(/\s+/g, ' ').slice(0, 200)}`;
      }).join('\n'));
    },
  );

  server.registerTool(
    'send',
    {
      title: 'Enviar mensaje',
      description: 'Envía un mensaje de texto. Requiere confirm:true.',
      inputSchema: z.object({ chatId: z.union([z.string(), z.number()]), text: z.string().min(1).max(4096), confirm: z.boolean().optional() }),
    },
    async (args) => {
      assertWritable();
      if (args.confirm !== true) throw new Error('send requiere confirm:true y confirmación explícita');
      checkRate();
      const config = loadConfig();
      ensureChatAllowed(config, args.chatId);
      const message = await api(config, 'sendMessage', { chat_id: args.chatId, text: args.text });
      audit({ tool: 'send', chatId: args.chatId, messageId: message?.message_id || null, ok: true });
      return textResult(`Mensaje enviado a ${args.chatId} (id ${message?.message_id || 'desconocido'}).`);
    },
  );

  server.registerTool(
    'photo',
    {
      title: 'Enviar foto',
      description: 'Envía una foto local. Requiere confirm:true.',
      inputSchema: z.object({
        chatId: z.union([z.string(), z.number()]),
        path: z.string().min(3),
        caption: z.string().max(1024).optional(),
        confirm: z.boolean().optional(),
      }),
    },
    async (args) => {
      assertWritable();
      if (args.confirm !== true) throw new Error('photo requiere confirm:true y confirmación explícita');
      checkRate();
      const config = loadConfig();
      ensureChatAllowed(config, args.chatId);
      const file = ensureAllowedPath(config, args.path);
      if (!existsSync(file)) throw new Error(`archivo no encontrado: ${file}`);
      const bytes = statSync(file).size;
      if (bytes > 10 * 1024 * 1024) throw new Error('la foto supera 10 MB');
      const form = new FormData();
      form.append('chat_id', String(args.chatId));
      if (args.caption) form.append('caption', args.caption);
      form.append('photo', new Blob([readFileSync(file)]), path.basename(file));
      const message = await api(config, 'sendPhoto', null, form);
      audit({ tool: 'photo', chatId: args.chatId, file: path.basename(file), messageId: message?.message_id || null, ok: true });
      return textResult(`Foto enviada a ${args.chatId} (id ${message?.message_id || 'desconocido'}).`);
    },
  );

  return server;
}

try {
  mkdirSync(CACHE_DIR, { recursive: true });
  if (!existsSync(CONFIG_FILE)) {
    mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
    writeFileSync(CONFIG_FILE, JSON.stringify({ token: '', allowedChatIds: [], allowedPaths: [process.env.USERPROFILE || ''] }, null, 2) + '\n', 'utf8');
  }
} catch (e) { log(`init: ${e.message}`); }
log(`modo ${READ_ONLY ? 'read-only' : 'normal'} · config: ${CONFIG_FILE}`);
serveStdio(buildServer, { onerror: (e) => log(`serveStdio: ${e.message}`) });
process.on('uncaughtException', (e) => log(`excepción: ${e.message}`));
process.on('unhandledRejection', (e) => log(`rechazo: ${e && e.message ? e.message : String(e)}`));
