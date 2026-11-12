import { readFile } from 'node:fs/promises';
import path from 'node:path';

// Billing is intentionally unavailable in the private pilot. Keep the
// proposed display settings separate from a future verified payment flow.
export interface MonetizationConfig {
  paypalMode: 'sandbox' | 'live';
  proPrice: number;
  proCurrency: string;
  admobAppId: string;
  admobBannerAdUnit: string;
}

export function loadMonetizationConfig(): MonetizationConfig {
  return {
    paypalMode: process.env.PATEX_PAYPAL_MODE === 'live' ? 'live' : 'sandbox',
    proPrice: Number(process.env.PATEX_PRO_PRICE) || 9.99,
    proCurrency: process.env.PATEX_PRO_CURRENCY || 'USD',
    admobAppId: process.env.PATEX_ADMOB_APP_ID || '',
    admobBannerAdUnit: process.env.PATEX_ADMOB_BANNER_AD_UNIT || '',
  };
}

interface Subscription {
  accountId: string;
  paid: boolean;
  plan: string;
  since: string;
}

export class SubscriptionStore {
  private root: string;
  constructor(dataRoot: string) { this.root = path.join(dataRoot, '_subscriptions'); }

  async get(accountId: string): Promise<Subscription | null> {
    return readFile(path.join(this.root, `sub-${accountId}.json`), 'utf8')
      .then(value => JSON.parse(value) as Subscription)
      .catch(() => null);
  }
}
