import request from 'supertest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Accounts } from '../src/server/auth.js';
import { ProjectStore } from '../src/server/store.js';
import { createApp } from '../src/server/app.js';
import { SubscriptionStore } from '../src/server/monetization.js';

test('unverified webhooks and incomplete checkout cannot grant access', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'patex-billing-'));
  const priorClientId = process.env.PATEX_PAYPAL_CLIENT_ID;
  process.env.PATEX_PAYPAL_CLIENT_ID = 'configured-looking-test-id';
  try {
    const owner = await new Accounts(root).create('owner', true);
    const app = createApp(new ProjectStore(root), { token: 'owner-secret' });
    const webhook = { event_type: 'PAYMENT.CAPTURE.COMPLETED',
      resource: { accountId: owner.id, id: 'FAKE-ORDER', status: 'COMPLETED' } };
    await request(app).post('/api/monetization/webhook').send(webhook).expect(503);
    const status = await request(app).get('/api/monetization/status')
      .set('Authorization', 'Bearer owner-secret').expect(200);
    expect(status.body.paid).toBe(false);
    expect(status.body.adsEnabled).toBe(false);
    expect(await new SubscriptionStore(root).get(owner.id)).toBeNull();
    const config = await request(app).get('/api/monetization/config')
      .set('Authorization', 'Bearer owner-secret').expect(200);
    expect(config.body.paypalConfigured).toBe(false);
    expect(config.body.billingAvailable).toBe(false);
    await request(app).post('/api/monetization/paypal/create-order')
      .set('Authorization', 'Bearer owner-secret').send({}).expect(503);
    await request(app).post('/api/monetization/paypal/capture')
      .set('Authorization', 'Bearer owner-secret').send({ orderId: 'FAKE-ORDER' }).expect(503);
    expect(await new SubscriptionStore(root).get(owner.id)).toBeNull();
  } finally {
    if (priorClientId === undefined) delete process.env.PATEX_PAYPAL_CLIENT_ID;
    else process.env.PATEX_PAYPAL_CLIENT_ID = priorClientId;
    await rm(root, { recursive: true, force: true });
  }
});
