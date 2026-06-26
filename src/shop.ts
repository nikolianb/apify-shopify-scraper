import { log } from 'crawlee';

export interface ShopInfo {
    store_name: string | null;
    currency: string | null;
}

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// Try /shop.json first; if blocked, extract currency from the page HTML
export async function fetchShopInfo(storeUrl: string): Promise<ShopInfo | null> {
    // --- Attempt 1: /shop.json (works on ~30% of stores) ---
    try {
        const res = await fetch(`${storeUrl}/shop.json`, { headers: { Accept: 'application/json', 'User-Agent': UA } });
        if (res.ok) {
            const text = await res.text();
            if (text.trimStart().startsWith('{')) {
                const data = JSON.parse(text) as { shop?: { name?: string; currency?: string } };
                const shop = data.shop;
                if (shop?.currency) {
                    return {
                        store_name: shop.name ?? null,
                        currency: shop.currency,
                    };
                }
            }
        }
    } catch { /* fall through */ }

    // --- Attempt 2: extract from homepage HTML (Shopify themes embed currency in page JS) ---
    try {
        const res = await fetch(storeUrl, { headers: { 'User-Agent': UA } });
        if (!res.ok) return null;
        const html = await res.text();

        const currencyMatch =
            html.match(/"currency"\s*:\s*\{\s*"code"\s*:\s*"([A-Z]{3})"/) ??
            html.match(/"currency_code"\s*:\s*"([A-Z]{3})"/) ??
            html.match(/Shopify\.currency\s*=\s*\{[^}]*"active"\s*:\s*"([A-Z]{3})"/) ??
            html.match(/"currency"\s*:\s*"([A-Z]{3})"/);

        const currency = currencyMatch?.[1] ?? null;
        if (!currency) return null;

        return { store_name: null, currency };
    } catch (err) {
        log.debug(`Could not detect currency for ${storeUrl}: ${String(err)}`);
        return null;
    }
}
