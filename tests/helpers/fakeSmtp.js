// Faux serveur SMTP local pour les tests (sans STARTTLS). Mémorise les messages reçus.
const net = require('node:net');

function startFakeSmtp({ failRcpt = false, requireAuth = null } = {}) {
  const messages = [];
  const server = net.createServer((sock) => {
    let buf = ''; let data = null; let cur = { from: null, to: [], authed: false };
    const send = (l) => sock.write(`${l}\r\n`);
    send('220 fake ESMTP');
    sock.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      let i;
      while ((i = buf.indexOf('\r\n')) !== -1) {
        const line = buf.slice(0, i); buf = buf.slice(i + 2);
        if (data !== null) {
          if (line === '.') { messages.push({ from: cur.from, to: cur.to, raw: data.join('\r\n'), authed: cur.authed }); data = null; cur = { from: null, to: [], authed: cur.authed }; send('250 OK queued'); } else data.push(line.startsWith('..') ? line.slice(1) : line);
          continue;
        }
        const u = line.toUpperCase();
        if (u.startsWith('EHLO')) { send('250-fake'); send('250 AUTH PLAIN LOGIN'); }
        else if (u.startsWith('AUTH PLAIN')) {
          const [, , cred] = line.split(' ');
          const [, user, pass] = Buffer.from(cred || '', 'base64').toString('utf8').split('\0');
          if (requireAuth && (user !== requireAuth.user || pass !== requireAuth.pass)) send('535 auth failed'); else { cur.authed = true; send('235 ok'); }
        }
        else if (u.startsWith('MAIL FROM')) { cur.from = line.slice(10).trim(); send('250 OK'); }
        else if (u.startsWith('RCPT TO')) { if (failRcpt) send('550 no such user'); else { cur.to.push(line.slice(8).trim()); send('250 OK'); } }
        else if (u === 'DATA') { data = []; send('354 go'); }
        else if (u === 'QUIT') { send('221 bye'); sock.end(); }
        else send('250 OK');
      }
    });
    sock.on('error', () => {});
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({
    port: server.address().port, messages, close: () => new Promise((r) => server.close(r))
  })));
}

module.exports = { startFakeSmtp };
