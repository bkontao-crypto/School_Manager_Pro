// Module Documents (ordonnance §4.4).
//  - Métadonnées : CRUD via makeResource (module « documents », écriture par permission).
//  - Téléversement : POST /:id/file (champ « file »). Types autorisés : PDF, PNG, JPEG. Le type réel est vérifié
//    sur le contenu (signature de fichier) ET sur l'extension ; un document ne reçoit qu'un fichier (pas de remplacement
//    silencieux : les versions restent à implémenter).
//  - Stockage privé : hors du dossier public, nom aléatoire non prédictible, jamais le nom d'origine ni un chemin fourni par le client.
//  - Téléchargement : GET /:id/file, authentifié, contrôle d'établissement ; un brouillon ou archivé n'est visible
//    qu'avec le droit d'écriture sur le module (sinon 404).
//  - Chaque téléversement et téléchargement est journalisé.
//  Limites : pas d'analyse antivirus (service non disponible dans cet environnement) ; pas de versions ; pas de rattachement fin par classe.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const multer = require('multer');
const db = require('../utils/db');
const { HttpError, wrap } = require('../utils/http');
const { makeResource } = require('../utils/resource');
const { isUuid } = require('../utils/validate');
const { requireWrite, permissionsFor } = require('../utils/permissions');
const { audit } = require('../utils/audit');

const MAX_MB = Number(process.env.DOCUMENT_MAX_MB) || 10;
const STORAGE_DIR = path.resolve(process.env.DOCUMENTS_DIR || path.join(process.cwd(), 'storage', 'documents'));
const STORAGE_NAME = /^[a-f0-9]{48}\.bin$/;

// Signature (« magic number ») attendue pour chaque type autorisé, et extensions acceptées.
const TYPES = {
  'application/pdf': { ext: ['.pdf'], magic: (b) => b.subarray(0, 5).toString('latin1') === '%PDF-' },
  'image/png': { ext: ['.png'], magic: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  'image/jpeg': { ext: ['.jpg', '.jpeg'], magic: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff }
};

function detectType(buf, originalName) {
  const ext = path.extname(originalName || '').toLowerCase();
  for (const [mime, spec] of Object.entries(TYPES)) {
    if (spec.ext.includes(ext) && spec.magic(buf)) return mime;
  }
  return null;
}

// Nom d'origine affiché : seulement le nom de fichier, sans caractères de contrôle ni séparateurs de dossiers.
function safeOriginalName(name) {
  const base = path.basename(String(name || 'document')).replace(/[\u0000-\u001f\u007f"\\/]/g, '_').slice(0, 255);
  return base || 'document';
}

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_MB * 1024 * 1024, files: 1 } });
const uploadOne = (req, res, next) => upload.single('file')(req, res, (err) => {
  if (!err) return next();
  if (err.code === 'LIMIT_FILE_SIZE') return next(new HttpError(413, `Fichier trop volumineux (maximum ${MAX_MB} Mo).`));
  return next(new HttpError(400, 'Téléversement invalide.'));
});

const router = makeResource({
  entity: 'document',
  table: 'documents',
  select: 'id, title, type, class_id, status, original_name, mime_type, size_bytes, uploaded_at, published_at, created_at',
  orderBy: 'created_at DESC',
  filters: { class_id: { type: 'uuid' }, status: { type: 'enum', values: ['brouillon', 'publie', 'archive'] } },
  fields: {
    title: { type: 'string', required: true, max: 255 },
    type: { type: 'string', max: 100 },
    class_id: { type: 'uuid', nullable: true },
    status: { type: 'enum', values: ['brouillon', 'publie', 'archive'] }
  },
  module: 'documents'
});

// Téléversement du fichier d'un document existant (une seule fois par document).
router.post('/:id/file', requireWrite('documents'), uploadOne, wrap(async (req, res) => {
  if (!isUuid(req.params.id)) throw new HttpError(400, 'Identifiant invalide.');
  if (!req.file) throw new HttpError(400, 'Aucun fichier reçu (champ « file »).');
  const buf = req.file.buffer;
  const mime = detectType(buf, req.file.originalname);
  if (!mime) throw new HttpError(415, 'Type non autorisé : PDF, PNG ou JPEG uniquement, et le contenu doit correspondre à l’extension.');

  const doc = await db.query('SELECT id, storage_name FROM documents WHERE id = $1 AND tenant_id = $2', [req.params.id, req.tenantId]);
  if (!doc.rows.length) throw new HttpError(404, 'Document introuvable.');
  if (doc.rows[0].storage_name) throw new HttpError(409, 'Un fichier est déjà joint à ce document. Créez un nouveau document pour un autre fichier.');

  const storageName = `${crypto.randomBytes(24).toString('hex')}.bin`;
  const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
  await fs.promises.mkdir(STORAGE_DIR, { recursive: true, mode: 0o700 });
  const target = path.join(STORAGE_DIR, storageName);
  await fs.promises.writeFile(target, buf, { flag: 'wx', mode: 0o600 });

  let row;
  try {
    const r = await db.query(
      `UPDATE documents
          SET storage_name = $3, original_name = $4, mime_type = $5, size_bytes = $6, sha256 = $7, uploaded_by = $8, uploaded_at = now()
        WHERE id = $1 AND tenant_id = $2 AND storage_name IS NULL
        RETURNING id, title, status, original_name, mime_type, size_bytes, uploaded_at`,
      [req.params.id, req.tenantId, storageName, safeOriginalName(req.file.originalname), mime, buf.length, sha256, req.user.id]
    );
    if (!r.rows.length) throw new HttpError(409, 'Un fichier est déjà joint à ce document.');
    row = r.rows[0];
  } catch (e) {
    await fs.promises.unlink(target).catch(() => {}); // pas de fichier orphelin si la base refuse
    throw e;
  }
  await audit(req, { action: 'document.upload', entity: 'document', entityId: row.id, details: { mime_type: mime, size_bytes: buf.length, sha256 } });
  res.status(201).json({ data: row });
}));

// Téléchargement : brouillons et archives réservés à ceux qui peuvent écrire dans le module.
router.get('/:id/file', wrap(async (req, res) => {
  if (!isUuid(req.params.id)) throw new HttpError(400, 'Identifiant invalide.');
  const r = await db.query(
    'SELECT storage_name, original_name, mime_type, status FROM documents WHERE id = $1 AND tenant_id = $2',
    [req.params.id, req.tenantId]
  );
  const doc = r.rows[0];
  if (!doc || !doc.storage_name) throw new HttpError(404, 'Fichier introuvable.');
  if (doc.status !== 'publie') {
    const perms = await permissionsFor(req.tenantId, req.user.role);
    if (perms.documents !== 'write') throw new HttpError(404, 'Fichier introuvable.');
  }
  if (!STORAGE_NAME.test(doc.storage_name)) throw new HttpError(500, 'Stockage incohérent.');
  const buf = await fs.promises.readFile(path.join(STORAGE_DIR, doc.storage_name)).catch(() => null);
  if (!buf) throw new HttpError(404, 'Fichier introuvable.');
  await audit(req, { action: 'document.download', entity: 'document', entityId: req.params.id });
  res.set({
    'Content-Type': doc.mime_type,
    'Content-Length': String(buf.length),
    'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(doc.original_name)}`,
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'private, no-store'
  });
  res.send(buf);
}));

module.exports = router;
