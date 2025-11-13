// src/server.js
const express = require('express');
const mysql = require('mysql2/promise');
const { v4: uuidv4 } = require('uuid');
const app = express();
app.use(express.json());

const RESERVATION_TTL_MINUTES = parseInt(process.env.RESERVATION_TTL_MINUTES || '30', 10);
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) { console.error('Set DATABASE_URL'); process.exit(1); }

let pool;
async function initPool() { if (!pool) pool = mysql.createPool(DATABASE_URL); }
initPool().catch(err=>{ console.error(err); process.exit(1); });

async function sendEmail(to, subject, text) { console.log('Email ->', to, subject, text); }
async function sendSMS(to, text) { console.log('SMS ->', to, text); }

app.post('/api/raffles', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const id = uuidv4();
    const { title, description, start_at, end_at, draw_at, external_draw_platform, total_numbers, banner_url, status } = req.body;
    await conn.query(
      `INSERT INTO raffles (id, title, description, start_at, end_at, draw_at, external_draw_platform, total_numbers, banner_url, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [id, title, description || null, start_at || null, end_at || null, draw_at || null, external_draw_platform || null, total_numbers || null, banner_url || null, status || 'draft']
    );
    res.json({ id });
  } catch (err) {
    console.error(err); res.status(500).json({ error: 'Error interno' });
  } finally { conn.release(); }
});

app.post('/api/raffles/:raffleId/populate', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const raffleId = req.params.raffleId;
    const total = req.body.total_numbers;
    if (!total || total <= 0) return res.status(400).json({ error: 'total_numbers required > 0' });
    await conn.query('CALL populate_raffle_numbers(?, ?)', [raffleId, total]);
    res.json({ status: 'populated', total_numbers: total });
  } catch (err) { console.error('populate error', err); res.status(500).json({ error: 'Error interno' }); } finally { conn.release(); }
});

app.post('/api/raffles/:raffleId/preorders', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const raffleId = req.params.raffleId;
    const { buyer_name, buyer_email, buyer_phone, buyer_id_number, requested_number } = req.body;
    const [rRows] = await conn.query('SELECT id, total_numbers, status FROM raffles WHERE id = ? FOR UPDATE', [raffleId]);
    if (rRows.length === 0) { await conn.rollback(); return res.status(404).json({ error: 'Rifa no encontrada' }); }
    const raffle = rRows[0];
    if (raffle.status !== 'published') { await conn.rollback(); return res.status(400).json({ error: 'Rifa no está publicada' }); }
    const preorderId = uuidv4();
    await conn.query(
      `INSERT INTO preorders (id, raffle_id, requested_number, buyer_name, buyer_email, buyer_phone, buyer_id_number, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', NOW())`,
      [preorderId, raffleId, requested_number || null, buyer_name, buyer_email, buyer_phone, buyer_id_number]
    );
    const expiresAt = new Date(Date.now() + RESERVATION_TTL_MINUTES * 60 * 1000);
    const expiresAtStr = expiresAt.toISOString().slice(0, 19).replace('T', ' ');

    if (requested_number != null) {
      const [upd] = await conn.query(
        `UPDATE raffle_numbers SET state='reserved', preorder_id=?, reserved_at=NOW(), expires_at=? WHERE raffle_id=? AND number=? AND state='available'`,
        [preorderId, expiresAtStr, raffleId, requested_number]
      );
      if (upd.affectedRows === 0) { await conn.rollback(); return res.status(409).json({ error: 'Número no disponible' }); }
      await conn.commit(); return res.json({ preorder_id: preorderId, reserved_number: requested_number });
    }

    const [availRows] = await conn.query(
      `SELECT id, number FROM raffle_numbers WHERE raffle_id = ? AND state = 'available' ORDER BY number LIMIT 1 FOR UPDATE`,
      [raffleId]
    );
    if (availRows.length === 0) {
      if (raffle.total_numbers == null) {
        const [maxRow] = await conn.query(`SELECT COALESCE(MAX(number),0) as maxnum FROM raffle_numbers WHERE raffle_id = ?`, [raffleId]);
        const nextNum = (maxRow[0] && maxRow[0].maxnum ? Number(maxRow[0].maxnum) : 0) + 1;
        const newId = uuidv4();
        await conn.query(
          `INSERT INTO raffle_numbers (id, raffle_id, number, state, preorder_id, reserved_at, expires_at, created_at)
           VALUES (?, ?, ?, 'reserved', ?, NOW(), ?, NOW())`,
          [newId, raffleId, nextNum, preorderId, expiresAtStr]
        );
        await conn.query(`UPDATE preorders SET requested_number = ? WHERE id = ?`, [nextNum, preorderId]);
        await conn.commit();
        return res.json({ preorder_id: preorderId, reserved_number: nextNum });
      } else { await conn.rollback(); return res.status(409).json({ error: 'No hay números disponibles' }); }
    }

    const chosen = availRows[0];
    const [upd2] = await conn.query(
      `UPDATE raffle_numbers SET state='reserved', preorder_id=?, reserved_at=NOW(), expires_at=? WHERE id = ? AND state = 'available'`,
      [preorderId, expiresAtStr, chosen.id]
    );
    if (upd2.affectedRows === 0) { await conn.rollback(); return res.status(409).json({ error: 'Número ya reservado, reintente' }); }
    await conn.query(`UPDATE preorders SET requested_number = ? WHERE id = ?`, [chosen.number, preorderId]);
    await conn.commit();
    return res.json({ preorder_id: preorderId, reserved_number: chosen.number });
  } catch (err) { await conn.rollback().catch(()=>{}); console.error(err); res.status(500).json({ error: 'Error interno' }); } finally { conn.release(); }
});

app.post('/api/preorders/:preorderId/payments', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const preorderId = req.params.preorderId;
    const { bank_name, bank_sender_id, bank_payment_id, amount, currency, capture_url } = req.body;
    const [pRows] = await conn.query(`SELECT * FROM preorders WHERE id = ? FOR UPDATE`, [preorderId]);
    if (pRows.length === 0) { await conn.rollback(); return res.status(404).json({ error: 'Precompra no encontrada' }); }
    const preorder = pRows[0];
    if (['cancelled','assigned','rejected'].includes(preorder.status)) { await conn.rollback(); return res.status(400).json({ error: 'Precompra no aceptable para pagos' }); }
    const paymentId = uuidv4();
    await conn.query(
      `INSERT INTO payment_submissions (id, preorder_id, bank_name, bank_sender_id, bank_payment_id, amount, currency, capture_url, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'submitted', NOW())`,
      [paymentId, preorderId, bank_name, bank_sender_id, bank_payment_id, amount, currency || 'USD', capture_url]
    );
    await conn.query(`UPDATE preorders SET status = 'payment_submitted' WHERE id = ?`, [preorderId]);
    await conn.commit();
    return res.json({ status: 'submitted' });
  } catch (err) { await conn.rollback().catch(()=>{}); console.error(err); res.status(500).json({ error: 'Error interno' }); } finally { conn.release(); }
});

app.post('/api/admin/preorders/:preorderId/validate', async (req, res) => {
  const adminUserId = req.header('x-admin-id') || null;
  const { action, admin_note } = req.body;
  const preorderId = req.params.preorderId;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [pRows] = await conn.query(`SELECT * FROM preorders WHERE id = ? FOR UPDATE`, [preorderId]);
    if (pRows.length === 0) { await conn.rollback(); return res.status(404).json({ error: 'Precompra no encontrada' }); }
    const preorder = pRows[0];
    const [rnRows] = await conn.query(`SELECT * FROM raffle_numbers WHERE preorder_id = ? FOR UPDATE`, [preorderId]);
    const rn = rnRows[0] || null;

    if (action === 'reject') {
      if (rn) await conn.query(`UPDATE raffle_numbers SET state='available', preorder_id=NULL, reserved_at=NULL, expires_at=NULL WHERE id = ?`, [rn.id]);
      await conn.query(`UPDATE preorders SET status='rejected', note=? WHERE id=?`, [admin_note || null, preorderId]);
      await conn.query(`UPDATE payment_submissions SET status='rejected', validated_by=?, validated_at=NOW(), admin_note=? WHERE preorder_id=? AND status='submitted'`,
        [adminUserId, admin_note || null, preorderId]);
      await conn.commit();
      await sendEmail(preorder.buyer_email, 'Pago rechazado', admin_note || 'Su pago fue rechazado.');
      await sendSMS(preorder.buyer_phone, 'Su pago fue rechazado.');
      return res.json({ status: 'rejected' });
    }

    if (action === 'validate') {
      let numberToAssign = rn ? rn.number : preorder.requested_number;
      if (!numberToAssign) { await conn.rollback(); return res.status(400).json({ error: 'No hay número reservado/solicitado' }); }
      const [tkRows] = await conn.query(`SELECT id FROM tickets WHERE raffle_id = ? AND number = ? FOR UPDATE`, [preorder.raffle_id, numberToAssign]);
      if (tkRows.length > 0) {
        if (rn) await conn.query(`UPDATE raffle_numbers SET state='available', preorder_id=NULL, reserved_at=NULL, expires_at=NULL WHERE id = ?`, [rn.id]);
        await conn.rollback();
        return res.status(409).json({ error: 'Número ya asignado' });
      }
      const ticketId = uuidv4();
      await conn.query(
        `INSERT INTO tickets (id, raffle_id, number, preorder_id, owner_name, owner_email, owner_phone, owner_id_number, assigned_by, assigned_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
        [ticketId, preorder.raffle_id, numberToAssign, preorderId, preorder.buyer_name, preorder.buyer_email, preorder.buyer_phone, preorder.buyer_id_number, adminUserId]
      );
      if (rn) await conn.query(`UPDATE raffle_numbers SET state='assigned', assigned_at=NOW(), assigned_by=?, preorder_id=? WHERE id = ?`, [adminUserId, preorderId, rn.id]);
      else {
        const [upd] = await conn.query(`UPDATE raffle_numbers SET state='assigned', assigned_at=NOW(), assigned_by=?, preorder_id=? WHERE raffle_id=? AND number=? AND state='available'`,
          [adminUserId, preorderId, preorder.raffle_id, numberToAssign]);
        if (upd.affectedRows === 0) {
          await conn.query(`INSERT INTO raffle_numbers (id, raffle_id, number, state, preorder_id, assigned_at, assigned_by, created_at)
            VALUES (?, ?, ?, 'assigned', ?, NOW(), ?, NOW())`, [uuidv4(), preorder.raffle_id, numberToAssign, preorderId, adminUserId]);
        }
      }
      await conn.query(`UPDATE preorders SET status='assigned' WHERE id=?`, [preorderId]);
      await conn.query(`UPDATE payment_submissions SET status='validated', validated_by=?, validated_at=NOW(), admin_note=? WHERE preorder_id=? AND status='submitted'`,
        [adminUserId, admin_note || null, preorderId]);
      await conn.query(`INSERT INTO audit_logs (id, entity_type, entity_id, action, payload, performed_by, created_at) VALUES (UUID(), 'preorder', ?, 'validated_and_assigned', ?, ?, NOW())`,
        [preorderId, JSON.stringify({ number: numberToAssign, ticket_id: ticketId }), adminUserId]);
      await conn.commit();
      const msg = `Su pago fue validado y se le asignó el número ${numberToAssign}`;
      await sendEmail(preorder.buyer_email, 'Boleto asignado', msg);
      await sendSMS(preorder.buyer_phone, msg);
      return res.json({ status: 'assigned', number: numberToAssign });
    }

    await conn.rollback();
    return res.status(400).json({ error: 'Acción desconocida' });
  } catch (err) { await conn.rollback().catch(()=>{}); console.error(err); res.status(500).json({ error: 'Error interno' }); } finally { conn.release(); }
});

async function cleanupExpiredRaffleNumbers() {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [expiredRows] = await conn.query(`SELECT id, preorder_id FROM raffle_numbers WHERE state='reserved' AND expires_at <= NOW() FOR UPDATE`);
    const preorderIds = expiredRows.map(r => r.preorder_id).filter(Boolean);
    if (preorderIds.length > 0) await conn.query(`UPDATE preorders SET status = 'pending' WHERE id IN (?)`, [preorderIds]);
    const [upd] = await conn.query(`UPDATE raffle_numbers SET state='available', preorder_id=NULL, reserved_at=NULL, expires_at=NULL WHERE state='reserved' AND expires_at <= NOW()`);
    await conn.commit();
    console.log('Cleanup released', upd.affectedRows);
  } catch (err) { await conn.rollback().catch(()=>{}); console.error('Cleanup error', err); } finally { conn.release(); }
}
setInterval(() => { cleanupExpiredRaffleNumbers().catch(console.error); }, 5 * 60 * 1000);

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`API escuchando en ${PORT}`));
}
module.exports = { app, poolPromise: () => pool };