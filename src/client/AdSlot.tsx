import { useEffect, useRef, useState } from 'react';

interface AdSlotProps {
  admobAppId: string;
  admobBannerAdUnit: string;
  /** Hide entirely when the user is paid. */
  adsEnabled: boolean;
}

/**
 * AdMob-ready banner slot.
 * - Mobile (Capacitor/Cordova): loads the native AdMob banner via the
 *   @capacitor-community/admob plugin when present.
 * - Web: renders a lightweight placeholder banner that can be swapped for
 *   AdSense or a direct AdMob web banner without code changes.
 */
export default function AdSlot({ admobAppId, admobBannerAdUnit, adsEnabled }: AdSlotProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!adsEnabled) return;
    const el = ref.current;
    if (!el) return;

    // ── Native (Capacitor) path ──────────────────────────────────────────────
    const win = window as unknown as {
      Capacitor?: { isPluginAvailable: (p: string) => Promise<boolean> };
      AdMob?: {
        initialize: (opts: { appId: string }) => Promise<void>;
        createBannerAd: (opts: {
          adId: string;
          adSize: string;
          position: string;
        }) => Promise<{ show: () => Promise<void> }>;
      };
    };

    let cancelled = false;
    const native = async () => {
      try {
        if (win.Capacitor && (await win.Capacitor.isPluginAvailable('AdMob'))) {
          await win.AdMob!.initialize({ appId: admobAppId });
          const banner = await win.AdMob!.createBannerAd({
            adId: admobBannerAdUnit,
            adSize: 'BANNER',
            position: 'BOTTOM',
          });
          await banner.show();
          if (!cancelled) setReady(true);
        }
      } catch {
        /* fall through to web placeholder */
      }
    };
    void native();

    // ── Web fallback: AdSense-style placeholder ──────────────────────────────
    if (!win.AdMob) {
      el.innerHTML = `
        <div class="ad-banner" role="complementary" aria-label="Advertisement">
          <span class="ad-label">AD</span>
          <span class="ad-text">Patex Pro — remove ads, unlimited projects</span>
          <span class="ad-cta">Upgrade</span>
        </div>`;
      if (!cancelled) setReady(true);
    }

    return () => { cancelled = true; };
  }, [adsEnabled, admobAppId, admobBannerAdUnit]);

  if (!adsEnabled) return null;
  return <div ref={ref} className="ad-slot" data-ready={ready} />;
}
