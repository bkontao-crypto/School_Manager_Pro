// Client SMTP minimal, sans dépendance : connexion directe (TLS implicite, port 465) ou STARTTLS (587),
// authentification PLAIN / LOGIN, message MIME UTF-8 (texte + HTML en base64). Suffisant pour des notifications
// transactionnelles (rappels, factures, réinitialisation de mot de passe).

const net = require('node:net');
const tls = require('node:tls');
const crypto = require('node:crypto');

const clean = (s) => String(s || '').replace(/[\r\n]+/g, ' ').trim();           // anti-injection d'en-têtes
const addr = (s) => { const m = clean(s).match(/<([^<>\s]+)>$/); return m ? m[1] : clean(s); };
const encodeWord = (s) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=`);
const b64lines = (s) => Buffer.from(s, 'utf8').toString('base64').replace(/(.{76})/g, '$1\r\n');

// Pièces jointes : [{ filename, contentType, content: Buffer }] → multipart/mixed contenant le corps (texte / HTML) puis les fichiers en base64.
const safeName = (s) => String(s || 'piece-jointe').replace(/[^\w.\- ]+/g, '_').slice(0, 100);
const b64buf = (buf) => Buffer.from(buf).toString('base64').replace(/(.{76})/g, '$1\r\n');

function buildMessage({ from, to, subject, text, html, messageId, attachments = [] }) {
  if (attachments.length) {
    const outer = `smp_mix_${crypto.randomBytes(12).toString('hex')}`;
    const inner = buildMessage({ from, to, subject, text, html, messageId });
    const cut = inner.indexOf('\r\n\r\n');
    const innerHead = inner.slice(0, cut).split('\r\n'); const innerBody = inner.slice(cut + 4);
    const ctLine = innerHead.find((l) => /^Content-Type:/i.test(l)); const cte = innerHead.find((l) => /^Content-Transfer-Encoding:/i.test(l));
    const head = innerHead.filter((l) => l !== ctLine && l !== cte);
    head.push(`Content-Type: multipart/mixed; boundary="${outer}"`);
    const parts = [`--${outer}`, ctLine, ...(cte ? [cte] : []), '', innerBody.replace(/\r\n$/, '')];
    for (const a of attachments) {
      const n = safeName(a.filename);
      parts.push(`--${outer}`, `Content-Type: ${a.contentType || 'application/octet-stream'}; name="${n}"`, 'Content-Transfer-Encoding: base64', `Content-Disposition: attachment; filename="${n}"`, '', b64buf(a.content));
    }
    parts.push(`--${outer}--`, '');
    return `${head.join('\r\n')}\r\n\r\n${parts.join('\r\n')}`;
  }
  const boundary = `smp_${crypto.randomBytes(12).toString('hex')}`;
  const head = [
    `From: ${clean(from)}`, `To: ${clean(to)}`, `Subject: ${encodeWord(clean(subject))}`, `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${messageId || crypto.randomBytes(12).toString('hex')}@school-manager-pro>`, 'MIME-Version: 1.0'
  ];
  let body;
  if (html) {
    head.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
    body = [`--${boundary}`, 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', b64lines(text || ''),
      `--${boundary}`, 'Content-Type: text/html; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', b64lines(html), `--${boundary}--`, ''].join('\r\n');
  } else {
    head.push('Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64');
    body = `${b64lines(text || '')}\r\n`;
  }
  return `${head.join('\r\n')}\r\n\r\n${body}`;
}

// Lecteur de réponses SMTP (gère les réponses multi-lignes « 250-... / 250 ... »).
function makeReader(initial) {
  let socket = initial; let buf = ''; let waiter = null;
  const queue = [];
  const flush = () => {
    for (;;) {
      const lines = buf.split('\r\n');
      let end = -1;
      for (let i = 0; i < lines.length - 1; i++) { if (/^\d{3} /.test(lines[i]) || /^\d{3}$/.test(lines[i])) { end = i; break; } }
      if (end < 0) return;
      const chunk = lines.slice(0, end + 1);
      buf = lines.slice(end + 1).join('\r\n');
      queue.push({ code: Number(chunk[end].slice(0, 3)), lines: chunk });
    }
  };
  const onData = (d) => { buf += d.toString('utf8'); flush(); if (waiter && queue.length) { const w = waiter; waiter = null; w.resolve(queue.shift()); } };
  const onError = (e) => { if (waiter) { const w = waiter; waiter = null; w.reject(e); } else queue.push({ error: e }); };
  const attach = (s) => { socket = s; s.on('data', onData); s.on('error', onError); s.on('close', () => onError(new Error('Connexion SMTP fermée.'))); };
  attach(initial);
  return {
    attach,
    read: (timeoutMs) => new Promise((resolve, reject) => {
      if (queue.length) { const r = queue.shift(); return r.error ? reject(r.error) : resolve(r); }
      const t = setTimeout(() => { waiter = null; reject(new Error('Délai SMTP dépassé.')); }, timeoutMs);
      waiter = { resolve: (v) => { clearTimeout(t); resolve(v); }, reject: (e) => { clearTimeout(t); reject(e); } };
    }),
    detach: () => { socket.removeAllListeners('data'); socket.removeAllListeners('error'); socket.removeAllListeners('close'); }
  };
}

async function sendSmtp(opts) {
  const { host, port = 587, secure = false, user, pass, from, to, subject, text, html, attachments, timeoutMs = 15000, rejectUnauthorized = true } = opts;
  if (!host || !from || !to) throw new Error('Configuration SMTP incomplète.');
  const toAddr = addr(to); const fromAddr = addr(from);
  if (!/^[^\s@<>]+@[^\s@<>]+$/.test(toAddr) || !/^[^\s@<>]+@[^\s@<>]+$/.test(fromAddr)) throw new Error('Adresse e-mail invalide.');
  let socket = await new Promise((resolve, reject) => {
    const s = secure ? tls.connect({ host, port, servername: host, rejectUnauthorized }, () => resolve(s)) : net.connect({ host, port }, () => resolve(s));
    s.setTimeout(timeoutMs, () => s.destroy(new Error('Délai de connexion SMTP dépassé.')));
    s.once('error', reject);
  });
  socket.removeAllListeners('error');
  let reader = makeReader(socket);
  const send = (line) => socket.write(`${line}\r\n`);
  const expect = async (codes, label) => {
    const r = await reader.read(timeoutMs);
    if (!codes.includes(r.code)) throw new Error(`SMTP ${label} : ${r.lines.join(' ').slice(0, 200)}`);
    return r;
  };
  try {
    await expect([220], 'accueil');
    const helo = 'localhost';
    send(`EHLO ${helo}`);
    let ehlo = await expect([250], 'EHLO');
    if (!secure && ehlo.lines.some((l) => /STARTTLS/i.test(l))) {
      send('STARTTLS'); await expect([220], 'STARTTLS');
      reader.detach();
      socket = await new Promise((resolve, reject) => { const t = tls.connect({ socket, servername: host, rejectUnauthorized }, () => resolve(t)); t.once('error', reject); });
      socket.removeAllListeners('error');
      reader = makeReader(socket);
      send(`EHLO ${helo}`); ehlo = await expect([250], 'EHLO');
    }
    if (user) {
      const mech = ehlo.lines.join(' ');
      if (/AUTH[^\r\n]*PLAIN/i.test(mech)) {
        send(`AUTH PLAIN ${Buffer.from(`\0${user}\0${pass}`).toString('base64')}`); await expect([235], 'authentification');
      } else if (/AUTH[^\r\n]*LOGIN/i.test(mech)) {
        send('AUTH LOGIN'); await expect([334], 'authentification');
        send(Buffer.from(user).toString('base64')); await expect([334], 'authentification');
        send(Buffer.from(pass || '').toString('base64')); await expect([235], 'authentification');
      } else throw new Error('Le serveur SMTP ne propose pas d’authentification PLAIN ou LOGIN.');
    }
    send(`MAIL FROM:<${fromAddr}>`); await expect([250], 'MAIL FROM');
    send(`RCPT TO:<${toAddr}>`); await expect([250, 251], 'RCPT TO');
    send('DATA'); await expect([354], 'DATA');
    const msg = buildMessage({ from, to, subject, text, html, attachments }).replace(/\r?\n/g, '\r\n').replace(/^\./gm, '..');
    socket.write(`${msg}\r\n.\r\n`);
    await expect([250], 'envoi');
    send('QUIT');
    return { accepted: toAddr };
  } finally {
    reader.detach();
    socket.destroy();
  }
}

module.exports = { sendSmtp, buildMessage };
