const request = require('supertest');
const { app, poolPromise } = require('../../src/server');
const { v4: uuidv4 } = require('uuid');

let pool;
beforeAll(async () => {
  pool = await poolPromise();
});

afterAll(async () => {
  try {
    await pool.query(`DELETE t FROM tickets t JOIN raffles r ON t.raffle_id = r.id WHERE r.title = ?`, ['E2E Test Rifa']);
    await pool.query(`DELETE FROM raffle_numbers WHERE raffle_id IN (SELECT id FROM raffles WHERE title = ?)`, ['E2E Test Rifa']);
    await pool.query(`DELETE FROM payment_submissions WHERE preorder_id IN (SELECT p.id FROM preorders p JOIN raffles r ON p.raffle_id = r.id WHERE r.title = ?)`, ['E2E Test Rifa']);
    await pool.query(`DELETE p FROM preorders p JOIN raffles r ON p.raffle_id = r.id WHERE r.title = ?`, ['E2E Test Rifa']);
    await pool.query(`DELETE FROM raffles WHERE title = ?`, ['E2E Test Rifa']);
  } catch (e) {
    console.warn('cleanup error', e);
  }
  await pool.end();
});

test('E2E flow: create raffle, populate numbers, preorder, submit payment, admin validate -> ticket created', async () => {
  const createRes = await request(app)
    .post('/api/raffles')
    .send({ title: 'E2E Test Rifa', total_numbers: 5, status: 'published' })
    .expect(200);
  const raffleId = createRes.body.id;
  expect(raffleId).toBeDefined();

  const popRes = await request(app)
    .post(`/api/raffles/${raffleId}/populate`)
    .send({ total_numbers: 5 })
    .expect(200);
  expect(popRes.body.status).toBe('populated');

  const preorderRes = await request(app)
    .post(`/api/raffles/${raffleId}/preorders`)
    .send({
      buyer_name: 'Juan Perez',
      buyer_email: 'juan@example.test',
      buyer_phone: '+123456789',
      buyer_id_number: 'V1234567'
    })
    .expect(200);
  expect(preorderRes.body.preorder_id).toBeDefined();
  expect(preorderRes.body.reserved_number).toBeGreaterThanOrEqual(1);
  const preorderId = preorderRes.body.preorder_id;
  const reservedNumber = preorderRes.body.reserved_number;

  await request(app)
    .post(`/api/preorders/${preorderId}/payments`)
    .send({
      bank_name: 'Banco Test',
      bank_sender_id: 'V1234567',
      bank_payment_id: 'PAY123',
      amount: 10.00,
      currency: 'USD',
      capture_url: 'https://example.test/capture.png'
    })
    .expect(200);

  const adminId = uuidv4();
  const validateRes = await request(app)
    .post(`/api/admin/preorders/${preorderId}/validate`)
    .set('x-admin-id', adminId)
    .send({ action: 'validate', admin_note: 'OK' })
    .expect(200);
  expect(validateRes.body.status).toBe('assigned');
  expect(validateRes.body.number).toBe(reservedNumber);

  const [tkRows] = await pool.query('SELECT * FROM tickets WHERE raffle_id = ? AND number = ?', [raffleId, reservedNumber]);
  expect(tkRows.length).toBe(1);
});