// usage: node cdp.mjs <url> <w> <h> <script.js> <outprefix>
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
const [url, w, h, scriptPath, out] = process.argv.slice(2);
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  '--headless=new', '--remote-debugging-port=9333', `--window-size=${w},${h}`, '--user-data-dir=/tmp/jintou-cdp/prof',
  '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--hide-scrollbars', ...(process.env.CHROME_ARGS ? process.env.CHROME_ARGS.split('|') : []), 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let targets;
for (let i = 0; i < 50; i++) { try { targets = await (await fetch('http://127.0.0.1:9333/json')).json(); break; } catch { await sleep(200); } }
const page = targets.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
let id = 0; const pending = new Map();
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } if (m.method === 'Runtime.consoleAPICalled' || m.method === 'Runtime.exceptionThrown') console.log('[page]', JSON.stringify(m.params).slice(0, 1200)); });
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
await send('Runtime.enable');
await send('Network.enable');
await send('Network.setCacheDisabled', { cacheDisabled: true });
await send('Emulation.setDeviceMetricsOverride', { width: +w, height: +h, deviceScaleFactor: +(process.env.DSF || 1), mobile: !!process.env.MOBILE });
if (process.env.MOBILE) await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await send('Page.navigate', { url });
await sleep(2500);
let shotN = 0;
globalThis.shot = async (name) => { const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(`${out}-${name || shotN++}.png`, Buffer.from(r.result.data, 'base64')); };
globalThis.ev = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); return r.result.exceptionDetails ? 'ERR ' + JSON.stringify(r.result.exceptionDetails).slice(0, 400) : r.result.result.value; };
globalThis.sleep = sleep; globalThis.send = send;
const AsyncFn = Object.getPrototypeOf(async () => {}).constructor;
await new AsyncFn(readFileSync(scriptPath, 'utf8'))();
ws.close(); chrome.kill();
