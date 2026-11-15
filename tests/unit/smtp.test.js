const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { sendSmtp, buildMessage } = require('../../backend/src/utils/smtp');
const { startFakeSmtp } = require('../helpers/fakeSmtp');

describe('Client SMTP', () => {
  it('pièce jointe : multipart/mixed, base64 fidèle, nom assaini', () => {
    const pdf = Buffer.from('%PDF-1.4\nfake\x00\xff binaire');
    const m = buildMessage({ from: 'a@x.test', to: 'b@y.test', subject: 'S', text: 'Bonjour', html: '<p>Bonjour</p>', attachments: [{ filename: 'fac"ture\r\n.pdf', contentType: 'application/pdf', content: pdf }] });
    assert.match(m, /Content-Type: multipart\/mixed; boundary="smp_mix_/); assert.match(m, /multipart\/alternative/);
    assert.ok(!/\r\nBcc:/i.test(m)); assert.match(m, /filename="fac_ture_\.pdf"/);
    const b64 = /Content-Disposition: attachment[^\r\n]*\r\n\r\n([\s\S]*?)\r\n--smp_mix_/.exec(m)[1].replace(/\r\n/g, '');
    assert.deepEqual(Buffer.from(b64, 'base64'), pdf);
    assert.ok((m.match(/^Content-Type: multipart\/mixed/gm) || []).length === 1);
    const t = buildMessage({ from: 'a@x.test', to: 'b@y.test', subject: 'S', text: 'Texte seul', attachments: [{ filename: 'a.pdf', content: pdf }] });
    assert.match(t, /Content-Type: text\/plain/); assert.match(t, /name="a\.pdf"/);
  });

  it('construit un message MIME : sujet encodé, pas d’injection d’en-tête', () => {
    const m = buildMessage({ from: 'a@x.test', to: 'b@y.test', subject: 'Reçu é\r\nBcc: evil@z.test', text: 'Bonjour', html: '<p>Bonjour</p>' });
    assert.ok(!/\r\nBcc:/i.test(m));
    assert.match(m, /^From: /m);
    assert.match(m, /multipart\/alternative/);
  });

  it('envoie un message à un serveur SMTP (authentification PLAIN, points en début de ligne)', async () => {
    const srv = await startFakeSmtp({ requireAuth: { user: 'u', pass: 'p' } });
    try {
      await sendSmtp({ host: '127.0.0.1', port: srv.port, secure: false, user: 'u', pass: 'p', from: 'noreply@x.test', to: 'dest@y.test', subject: 'Sujet', text: 'ligne 1\n.ligne avec point\nfin', timeoutMs: 5000 });
      assert.equal(srv.messages.length, 1);
      assert.match(srv.messages[0].to[0], /dest@y\.test/);
      assert.ok(srv.messages[0].authed);
    } finally { await srv.close(); }
  });

  it('échoue proprement : mauvais identifiants, destinataire refusé, serveur absent', async () => {
    const bad = await startFakeSmtp({ requireAuth: { user: 'u', pass: 'p' } });
    await assert.rejects(sendSmtp({ host: '127.0.0.1', port: bad.port, user: 'u', pass: 'mauvais', from: 'a@x.test', to: 'b@y.test', subject: 's', text: 't', timeoutMs: 3000 }));
    await bad.close();
    const rej = await startFakeSmtp({ failRcpt: true });
    await assert.rejects(sendSmtp({ host: '127.0.0.1', port: rej.port, from: 'a@x.test', to: 'b@y.test', subject: 's', text: 't', timeoutMs: 3000 }));
    await rej.close();
    await assert.rejects(sendSmtp({ host: '127.0.0.1', port: 1, from: 'a@x.test', to: 'b@y.test', subject: 's', text: 't', timeoutMs: 2000 }));
  });
});
