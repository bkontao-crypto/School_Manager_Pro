// Faux fournisseur Twilio pour les tests : mémorise les messages reçus et peut refuser certains destinataires.
const http = require('node:http');

function startFakeTwilio() {
  const messages = []; const state = { rejectTo: new Set(), auth: null };
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      const f = Object.fromEntries(new URLSearchParams(raw));
      state.auth = req.headers.authorization;
      res.setHeader('Content-Type', 'application/json');
      if (!/\/2010-04-01\/Accounts\/[^/]+\/Messages\.json$/.test(req.url)) { res.statusCode = 404; return res.end('{}'); }
      if (state.rejectTo.has(f.To)) { res.statusCode = 400; return res.end(JSON.stringify({ message: 'Numéro non autorisé (test)' })); }
      messages.push({ to: f.To, from: f.From, body: f.Body, url: req.url });
      res.statusCode = 201; res.end(JSON.stringify({ sid: `SM${messages.length}` }));
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ port: server.address().port, messages, state, close: () => new Promise((r) => server.close(r)) })));
}
module.exports = { startFakeTwilio };
