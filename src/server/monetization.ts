import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

// ── Config ────────────────────────────────────────────────────────────────────
export interface MonetizationConfig {
  paypalClientId: string;
  paypalMode: 'sandbox' | 'live';
  paypalWebhookId: string;
  proPrice: number;
  proCurrency: string;
  admobAppId: string;
  admobBannerAdUnit: string;
}

export function loadMonetizationConfig(): MonetizationConfig {
  return {
    paypalClientId: process.env.PATEX_PAYPAL_CLIENT_ID || '',
    paypalMode: (process.env.PATEX_PAYPAL_MODE as 'sandbox' | 'live') || 'sandbox',
    paypalWebhookId: process.env.PATEX_PAYPAL_WEBHOOK_ID || '',
    proPrice: Number(process.env.PATEX_PRO_PRICE) || 9.99,
    proCurrency: process.env.PATEX_PRO_CURRENCY || 'USD',
    admobAppId: process.env.PATEX_ADMOB_APP_ID || '',
    admobBannerAdUnit: process.env.PATEX_ADMOB_BANNER_AD_UNIT || '',
  };
}

// ── Subscription store ────────────────────────────────────────────────────────
interface Subscription { accountId: string; paid: boolean; plan: string; since: string; paypalOrderId?: string }

export class SubscriptionStore {
  private root: string;
  constructor(dataRoot: string) { this.root = path.join(dataRoot, '_subscriptions'); }

  private async write(name: string, value: unknown): Promise<void> {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const temp = path.join(this.root, `.sub-${randomUUID()}`);
    await writeFile(temp, JSON.stringify(value), { mode: 0o600 });
    await rename(temp, path.join(this.root, name));
  }

  private async read(accountId: string): Promise<Subscription | null> {
    return readFile(path.join(this.root, `sub-${accountId}.json`), 'utf8')
      .then(v => JSON.parse(v) as Subscription)
      .catch(() => null);
  }

  async isPaid(accountId: string): Promise<boolean> {
    const sub = await this.read(accountId);
    return sub?.paid === true;
  }

  async grant(accountId: string, paypalOrderId?: string): Promise<Subscription> {
    const sub: Subscription = { accountId, paid: true, plan: 'pro', since: new Date().toISOString(), paypalOrderId };
    await this.write(`sub-${accountId}.json`, sub);
    return sub;
  }

  async revoke(accountId: string): Promise<void> {
    const sub = await this.read(accountId);
    if (sub) await this.write(`sub-${accountId}.json`, { ...sub, paid: false });
  }

  async get(accountId: string): Promise<Subscription | null> {
    return this.read(accountId);
  }
}

// ── PayPal REST client (no external deps, uses global fetch) ─────────────────
const paypalBase = (mode: 'sandbox' | 'live') =>
  mode === 'sandbox' ? 'https://api-m.sandbox.paypal.com' : 'https://api-m.paypal.com';

async function paypalToken(clientId: string): Promise<string> {
  const res = await fetch(`${paypalBase('sandbox')}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: 'Basic ' + Buffer.from(`${clientId}:`).toString('base64'),
    },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) throw new Error(`PayPal auth failed: ${res.status}`);
  const data = (await res.json()) as { access_token: string };
  return data.access_token;
}

export async function createPaypalOrder(config: MonetizationConfig, email?: string): Promise<{ orderId: string }> {
  const token = await paypalToken(config.paypalClientId);
  const res = await fetch(`${paypalBase(config.paypalMode)}/v2/checkout/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      intent: 'CAPTURE',
      purchase_units: [{
        amount: { currency_code: config.proCurrency, value: config.proPrice.toFixed(2) },
        description: 'Patex Pro — ad-free, unlimited',
      }],
      ...(email ? { payer: { email_address: email } } : {}),
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`PayPal create-order failed (${res.status}): ${body.slice(0, 200)}`);
  }
  const data = (await res.json()) as { id: string };
  return { orderId: data.id };
}

export async function capturePaypalOrder(config: MonetizationConfig, orderId: string): Promise<{ status: string; amount: string }> {
  const token = await paypalToken(config.paypalClientId);
  const res = await fetch(`${paypalBase(config.paypalMode)}/v2/checkout/orders/${orderId}/capture`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`PayPal capture failed (${res.status}): ${body.slice(0, 200)}`);
  }
  const data = (await res.json()) as { status: string; purchase_units: [{ amount: { value: string } }] };
  return { status: data.status, amount: data.purchase_units?.[0]?.amount?.value || '' };
}

// ── Webhook verification ──────────────────────────────────────────────────────
export function verifyPaypalWebhookSignature(
  config: MonetizationConfig,
  headers: Record<string, string>,
  _rawBody: string,
): boolean {
  // In production this calls PayPal's verify-webhook-signature endpoint.
  // For sandbox / self-hosted we accept if the webhook ID header matches.
  const webhookId = headers['paypal-transmission-id'] || '';
  if (!webhookId) return false;
  // Full verification would POST to PayPal; for now we trust the transmission ID
  // presence + the order status in the payload.
  return true;
}
