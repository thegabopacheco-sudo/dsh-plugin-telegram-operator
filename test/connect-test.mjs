// Test end-to-end de telegram-operator contra un mock local de la Bot API.
import path from 'node:path';
import http from 'node:http';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const packageDir = path.resolve(import.meta.dirname, '..');
const tmpDir = path.join(packageDir, 'test', 'tmp');
rmSync(tmpDir, { recursive: true, force: true });
mkdirSync(path.join(tmpDir, 'dsh-home', 'telegram-operator'), { recursive: true });
const png = path.join(tmpDir, 'foto.png');
execFileSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'color=c=red:size=64x64:duration=1', '-frames:v', '1', png], { stdio: 'ignore' });
writeFileSync(path.join(tmpDir, 'dsh-home', 'telegram-operator', 'config.json'), JSON.stringify({ token: 'TEST_TOKEN', allowedChatIds: ['111'], allowedPaths: [tmpDir] }, null, 2), 'utf8');

let sentMessage = null;
let sentPhoto = null;
const mock = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks);
    const route = new URL(req.url, 'http://127.0.0.1').pathname;
    const json = (status, value) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(value)); };
    if (route === '/botTEST_TOKEN/getMe') return json(200, { ok: true, result: { id: 123, username: 'wendigo_bot', first_name: 'Wendigo' } });
    if (route === '/botTEST_TOKEN/getUpdates') return json(200, { ok: true, result: [
      { update_id: 1, message: { message_id: 10, chat: { id: 111, username: 'cliente1' }, from: { username: 'cliente1' }, text: 'Hola, info del bot' } },
      { update_id: 2, message: { message_id: 11, chat: { id: 222, title: 'Grupo WENDIGO' }, from: { first_name: 'Gabriel' }, text: 'Anuncio listo' } },
    ] });
    if (route === '/botTEST_TOKEN/sendMessage') {
      sentMessage = JSON.parse(body.toString('utf8'));
      return json(200, { ok: true, result: { message_id: 99, chat: { id: sentMessage.chat_id }, text: sentMessage.text } });
    }
    if (route === '/botTEST_TOKEN/sendPhoto') {
      sentPhoto = { type: req.headers['content-type'], bytes: body.length };
      return json(200, { ok: true, result: { message_id: 100 } });
    }
    json(404, { ok: false, description: 'mock no soporta ' + route });
  });
});
await new Promise((r) => mock.listen(0, '127.0.0.1', r));
const apiBase = `http://127.0.0.1:${mock.address().port}`;

function makeClient(extraEnv = {}) {
  const entry = process.env.TELEGRAM_SERVER ? path.resolve(process.env.TELEGRAM_SERVER) : path.join(packageDir, 'server.mjs');
  const transport = new StdioClientTransport({ command: process.execPath, args: [entry], env: { SystemRoot: process.env.SystemRoot || 'C:\\Windows', PATH: process.env.PATH, USERPROFILE: process.env.USERPROFILE, HOME: process.env.HOME || process.env.USERPROFILE, TEMP: process.env.TEMP, TMP: process.env.TMP, DSH_HOME: path.join(tmpDir, 'dsh-home'), DSH_TELEGRAM_API_BASE: apiBase, ...extraEnv }, stderr: 'pipe' });
  transport.stderr?.on('data', (c) => process.stderr.write(`[server] ${c}`));
  const client = new Client({ name: 'telegram-test', version: '1.0.0' }, { capabilities: {}, versionNegotiation: { mode: 'auto' } });
  return client.connect(transport).then(() => ({ client, transport }));
}
const textOf = (r) => (r.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');

const { client, transport } = await makeClient();
console.log('tools:', (await client.listTools()).tools.map((t) => t.name).join(', '));
console.log('--- status ---'); console.log(textOf(await client.callTool({ name: 'status', arguments: {} })));
console.log('--- updates ---'); console.log(textOf(await client.callTool({ name: 'updates', arguments: { limit: 5 } })));
const noConfirm = await client.callTool({ name: 'send', arguments: { chatId: 111, text: 'hola' } });
console.log('send sin confirm isError:', noConfirm.isError === true);
const denied = await client.callTool({ name: 'send', arguments: { chatId: 222, text: 'hola', confirm: true } });
console.log('chat no permitido isError:', denied.isError === true);
const sent = await client.callTool({ name: 'send', arguments: { chatId: 111, text: 'Hola desde DSH', confirm: true } });
console.log('--- send ---'); console.log(textOf(sent));
console.log('mock recibió:', sentMessage?.text === 'Hola desde DSH' && String(sentMessage?.chat_id) === '111');
const photo = await client.callTool({ name: 'photo', arguments: { chatId: 111, path: png, caption: 'prueba', confirm: true } });
console.log('--- photo ---'); console.log(textOf(photo));
console.log('mock recibió foto multipart:', Boolean(sentPhoto?.type?.includes('multipart/form-data')) && sentPhoto.bytes > 0);
const outside = await client.callTool({ name: 'photo', arguments: { chatId: 111, path: path.join(tmpDir, '..', 'x.png'), confirm: true } });
console.log('foto fuera isError:', outside.isError === true);
await client.close(); try { await transport.close?.(); } catch {}
const { client: roClient, transport: roTransport } = await makeClient({ DSH_TELEGRAM_MODE: 'read-only' });
const roSend = await roClient.callTool({ name: 'send', arguments: { chatId: 111, text: 'x', confirm: true } });
console.log('read-only send isError:', roSend.isError === true);
const roUpdates = await roClient.callTool({ name: 'updates', arguments: {} });
console.log('read-only updates permitido:', roUpdates.isError !== true);
await roClient.close(); try { await roTransport.close?.(); } catch {}
mock.close();
console.log('OK');
