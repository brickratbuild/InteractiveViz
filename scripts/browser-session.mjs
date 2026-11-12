import { spawn } from 'node:child_process';
import { mkdir, readFile, mkdtemp } from 'node:fs/promises';
import path from 'node:path';

export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export async function browserSession(output) {
  await mkdir(output, { recursive: true });
  const profile = await mkdtemp(path.join(path.resolve(output), 'chrome-'));
  const chrome = spawn(process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
    '--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding', 'about:blank',
  ], { stdio: 'ignore', windowsHide: true });
  let processError; chrome.on('error', error => { processError = error; });
  let port;
  for (let i = 0; i < 100 && !port; i++) {
    if (processError) throw processError;
    try { port = (await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; } catch { await sleep(100); }
  }
  if (!port) { chrome.kill(); throw new Error('Chrome failed to start'); }
  const target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === 'page');
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let id = 0;
  const pending = new Map(), events = [], handlers = new Set();
  socket.onmessage = event => {
    const message = JSON.parse(event.data), item = pending.get(message.id);
    if (!item) { if (message.method) { events.push(message); for (const handler of handlers) handler(message); } return; }
    clearTimeout(item.timer); pending.delete(message.id);
    if (message.error) item.reject(new Error(message.error.message)); else item.resolve(message.result);
  };
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const rid = ++id, timer = setTimeout(() => { pending.delete(rid); reject(new Error(`${method} timed out`)); }, 180000);
    pending.set(rid, { resolve, reject, timer });
    socket.send(JSON.stringify({ id: rid, method, params }));
  });
  const evaluate = async expression => {
    const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  };
  await call('Runtime.enable'); await call('Page.enable'); await call('Log.enable');
  await call('Network.enable'); await call('Network.setBypassServiceWorker', { bypass: true });
  return { call, evaluate, events, profile, onEvent(handler) { handlers.add(handler); return () => handlers.delete(handler); }, async close() {
    socket.close(); chrome.kill();
    // Retain the local profile with validation artifacts; no recursive path deletion.
  } };
}
