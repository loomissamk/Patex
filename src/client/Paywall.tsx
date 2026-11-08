import { useCallback, useEffect, useState } from 'react';

declare global {
  interface Window {
    __PATEX_PAYPAL_CID?: string;
    paypal?: unknown;
  }
}

interface PayPalButtons {
  Buttons: (opts: Record<string, unknown>) => { render: (sel: string) => void };
}

interface MonetizationConfig {
  price: number;
  currency: string;
  paypalMode: string;
  paypalConfigured: boolean;
  admobAppId: string;
  admobBannerAdUnit: string;
  adsEnabled: boolean;
}

interface PaywallProps {
  api: (path: string, init?: RequestInit) => Promise<Response>;
  onUpgrade: () => void;
}

export default function Paywall({ api, onUpgrade }: PaywallProps) {
  const [config, setConfig] = useState<MonetizationConfig | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [orderId, setOrderId] = useState('');

  useEffect(() => {
    api('/api/monetization/config')
      .then(r => r.json())
      .then(setConfig)
      .catch(() => {});
  }, [api]);

  const startCheckout = useCallback(async () => {
    setBusy(true); setError('');
    try {
      const res = await api('/api/monetization/paypal/create-order', { method: 'POST', body: JSON.stringify({}) });
      const data = await res.json() as { orderId: string };
      setOrderId(data.orderId);
      // Load PayPal JS SDK dynamically
      const script = document.createElement('script');
      script.src = `https://www.paypal.com/sdk/js?client-id=${window.__PATEX_PAYPAL_CID || ''}&currency=${config?.currency || 'USD'}&intent=capture`;
      script.onload = async () => {
        const paypal = window.paypal as PayPalButtons | undefined;
        if (!paypal) { setError('PayPal SDK failed to load'); setBusy(false); return; }
        const container = document.getElementById('paypal-button-container');
        if (container) {
          container.innerHTML = '';
          paypal.Buttons({
            createOrder: (_: unknown, actions: { order: { create: (o: object) => Promise<{ id: string }> } }) =>
              actions.order.create({ purchase_units: [{ amount: { currency_code: config?.currency || 'USD', value: (config?.price || 9.99).toFixed(2) } }] }),
            onApprove: async (_: unknown, actions: { order: { capture: () => Promise<unknown> } }) => {
              await actions.order.capture();
              const capRes = await api('/api/monetization/paypal/capture', { method: 'POST', body: JSON.stringify({ orderId }) });
              const capData = await capRes.json();
              if (capData.paid) onUpgrade();
              else setError(capData.error || 'Payment not completed');
              setBusy(false);
            },
            onError: () => { setError('PayPal checkout error'); setBusy(false); },
          }).render('#paypal-button-container');
        }
      };
      script.onerror = () => { setError('Could not load PayPal. Check your connection.'); setBusy(false); };
      document.body.appendChild(script);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }, [api, config, orderId, onUpgrade]);

  if (!config) return null;
  if (!config.adsEnabled) return null; // already paid

  return (
    <div className="paywall-banner" role="region" aria-label="Upgrade to Patex Pro">
      <div className="paywall-content">
        <div className="paywall-text">
          <strong>Patex Pro</strong>
          <span>Remove ads · Unlimited projects · Priority builds</span>
          <span className="paywall-price">{config.currency} {config.price.toFixed(2)}/mo</span>
        </div>
        <div className="paywall-actions">
          <button className="primary" onClick={() => void startCheckout()} disabled={busy || !config.paypalConfigured}>
            {busy ? 'Opening PayPal…' : config.paypalConfigured ? 'Upgrade with PayPal' : 'Payments coming soon'}
          </button>
          {error && <small role="alert">{error}</small>}
        </div>
      </div>
      <div id="paypal-button-container" className="paypal-container" />
    </div>
  );
}
