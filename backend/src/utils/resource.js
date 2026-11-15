// Fabrique de ressources "liste paginée + création validée", partagée par les modules simples.
//
// Garanties communes :
//  - toutes les requêtes sont filtrées par l'établissement du jeton (req.tenantId), sans exception ;
//  - les entrées sont validées avant d'atteindre SQL ; les noms de tables et colonnes viennent du code, jamais du client ;
//  - la création est limitée aux rôles autorisés et inscrite dans le journal d'audit.

const express = require('express');
const db = require('./db');
const { validate } = require('./validate');
const { wrap, invalid, pageParams } = require('./http');
const { requireRole } = require('../middleware/auth');
const { requireWrite } = require('./permissions');
const { audit } = require('./audit');
const { sendCsv, EXPORT_MAX } = require('./csv');

function makeResource({
  entity,
  table,
  from = table,
  tenantCol = 'tenant_id',
  select = '*',
  orderBy,
  fields,
  filters = {},
  requireFilters = [],
  writeRoles = ['admin'],
  module, // clé de permission du module : si fournie, remplace writeRoles (droits configurables par établissement)
  defaults,
  create,
  afterCreate, // (req, row) : effet de bord non bloquant après création
  exportCsv // { filename, columns: [[clé, en-tête, format?]] } : GET /export.csv (mêmes filtres que la liste), tracé dans le journal d'audit
}) {
  const router = express.Router();

  if (exportCsv) {
    router.get('/export.csv', wrap(async (req, res) => {
      const { values: f, errors } = validate(req.query, filters, { partial: true });
      if (errors.length) return invalid(res, errors);
      const where = [`${tenantCol} = $1`]; const params = [req.tenantId];
      for (const [name, value] of Object.entries(f)) { params.push(value); where.push(`${filters[name].column || name} = $${params.length}`); }
      const rows = await db.query(`SELECT ${select} FROM ${from} WHERE ${where.join(' AND ')} ORDER BY ${orderBy} LIMIT ${EXPORT_MAX}`, params);
      await audit(req, { action: `${entity}.export`, entity, details: { rows: rows.rows.length } });
      sendCsv(res, exportCsv.filename, exportCsv.columns, rows.rows);
    }));
  }

  router.get('/', wrap(async (req, res) => {
    const { values: f, errors } = validate(req.query, filters, { partial: true });
    for (const name of requireFilters) {
      if (f[name] === undefined && !errors.some((e) => e.field === name)) errors.push({ field: name, message: 'Paramètre obligatoire' });
    }
    if (errors.length) return invalid(res, errors);

    const { limit, offset } = pageParams(req.query);
    const where = [`${tenantCol} = $1`];
    const params = [req.tenantId];
    for (const [name, value] of Object.entries(f)) {
      params.push(value);
      where.push(`${filters[name].column || name} = $${params.length}`);
    }
    const clause = where.join(' AND ');
    const [rows, count] = await Promise.all([
      db.query(`SELECT ${select} FROM ${from} WHERE ${clause} ORDER BY ${orderBy} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, offset]),
      db.query(`SELECT count(*) AS total FROM ${from} WHERE ${clause}`, params)
    ]);
    res.json({ data: rows.rows, meta: { total: Number(count.rows[0].total), limit, offset } });
  }));

  const guards = module ? [requireWrite(module)] : (writeRoles ? [requireRole(...writeRoles)] : []);
  router.post('/', ...guards, wrap(async (req, res) => {
    const { values, errors } = validate(req.body, fields);
    if (errors.length) return invalid(res, errors);
    const all = { ...values, ...(defaults ? defaults(req) : {}) };

    let row;
    if (create) {
      row = await create(req, all);
    } else {
      const cols = Object.keys(all);
      const marks = cols.map((_, i) => `$${i + 2}`);
      const result = await db.query(
        `INSERT INTO ${table} (tenant_id${cols.map((c) => `, ${c}`).join('')}) VALUES ($1${marks.map((m) => `, ${m}`).join('')}) RETURNING *`,
        [req.tenantId, ...cols.map((c) => all[c])]
      );
      row = result.rows[0];
    }
    await audit(req, { action: `${entity}.create`, entity, entityId: row.id });
    if (afterCreate) Promise.resolve().then(() => afterCreate(req, row)).catch(() => {});
    res.status(201).json({ data: row });
  }));

  return router;
}

module.exports = { makeResource };
