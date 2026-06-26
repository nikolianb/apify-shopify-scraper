import { Actor } from 'apify';
import { Dataset, HttpCrawler, log } from 'crawlee';
import { detectReviewPlatform, fetchReviews, type ReviewPlatform } from './reviews.js';
import { fetchCollections } from './collections.js';
import { fetchShopInfo, type ShopInfo } from './shop.js';

interface ShopifyVariant {
    id: number;
    title: string;
    sku: string;
    price: string;
    compare_at_price: string | null;
    available: boolean;
    inventory_quantity: number;
}

interface ShopifyProduct {
    id: number;
    title: string;
    handle: string;
    vendor: string;
    product_type: string;
    body_html: string;
    tags: string[];
    created_at: string;
    updated_at: string;
    published_at: string;
    variants: ShopifyVariant[];
    images: Array<{ src: string }>;
}

interface Input {
    storeUrls: string[];
    maxProductsPerStore?: number;
    includeVariants?: boolean;
    scrapeReviews?: boolean;
    maxReviewsPerProduct?: number;
    scrapeCollections?: boolean;
    onlyAvailable?: boolean;
    minDiscount?: number;
    createdAfter?: string;
    proxyConfig?: Record<string, unknown>;
}

await Actor.init();

const input = await Actor.getInput<Input>();
if (!input?.storeUrls?.length) throw new Error('storeUrls is required');

const {
    storeUrls,
    maxProductsPerStore,
    includeVariants = false,
    scrapeReviews = false,
    maxReviewsPerProduct = 50,
    scrapeCollections = false,
    onlyAvailable = false,
    minDiscount,
    createdAfter,
    proxyConfig,
} = input;

const createdAfterDate = createdAfter ? new Date(createdAfter) : null;

const proxyConfiguration = proxyConfig
    ? await Actor.createProxyConfiguration(proxyConfig)
    : undefined;

const normalizedUrls = storeUrls.map((u) => u.replace(/\/$/, ''));

// --- Pre-crawl: shop info, review platforms, collections ---

const reviewPlatforms = new Map<string, ReviewPlatform>();
const shopInfoMap = new Map<string, ShopInfo | null>();

for (const storeUrl of normalizedUrls) {
    log.info(`Fetching store info for ${storeUrl}...`);
    const shopInfo = await fetchShopInfo(storeUrl);
    shopInfoMap.set(storeUrl, shopInfo);
    if (shopInfo) log.info(`  → ${shopInfo.store_name ?? 'unknown'} (${shopInfo.currency ?? 'unknown currency'})`);

    if (scrapeReviews) {
        log.info(`Detecting review platform for ${storeUrl}...`);
        const platform = await detectReviewPlatform(storeUrl);
        reviewPlatforms.set(storeUrl, platform);
        log.info(`  → ${platform ? platform.type : 'none detected'}`);
    }

    if (scrapeCollections) {
        log.info(`Fetching collections for ${storeUrl}...`);
        const collections = await fetchCollections(storeUrl);
        log.info(`  → ${collections.length} collections`);

        for (const col of collections) {
            await Dataset.pushData({ record_type: 'collection', store_url: storeUrl, ...col });
        }
    }
}

// --- Main crawl: products ---

const startUrls = normalizedUrls.map((base) => ({
    url: `${base}/products.json?limit=250&page=1`,
    userData: { storeUrl: base, page: 1 },
}));

const storeProductCount = new Map<string, number>();

function calcDiscountPct(price: string, compareAt: string | null): number | null {
    if (!compareAt) return null;
    const p = parseFloat(price);
    const c = parseFloat(compareAt);
    if (!c || c <= p) return null;
    return Math.round(((c - p) / c) * 100);
}

const crawler = new HttpCrawler({
    proxyConfiguration,

    async requestHandler({ request, body, crawler: c }) {
        const { storeUrl, page } = request.userData as { storeUrl: string; page: number };
        const { products } = JSON.parse(body.toString()) as { products: ShopifyProduct[] };

        if (!products.length) return;

        const platform = reviewPlatforms.get(storeUrl) ?? null;
        const shopInfo = shopInfoMap.get(storeUrl) ?? null;
        let storedThisPage = 0;

        for (const product of products) {
            if (maxProductsPerStore !== undefined) {
                const current = storeProductCount.get(storeUrl) ?? 0;
                if (current >= maxProductsPerStore) break;
                storeProductCount.set(storeUrl, current + 1);
            }

            const available = product.variants.some((v) => v.available);

            // --- Filters ---
            if (onlyAvailable && !available) continue;
            if (createdAfterDate && new Date(product.created_at) < createdAfterDate) continue;

            const basePrice = product.variants[0]?.price ?? '0.00';
            const baseCompareAt = product.variants[0]?.compare_at_price ?? null;
            const discountPct = calcDiscountPct(basePrice, baseCompareAt);
            if (minDiscount !== undefined && (discountPct === null || discountPct < minDiscount)) continue;

            // --- Computed fields ---
            const description = product.body_html
                ? product.body_html.replace(/<[^>]+>/g, '').trim() || null
                : null;

            const variantPrices = product.variants.map((v) => parseFloat(v.price)).filter((p) => !isNaN(p));
            const min_price = variantPrices.length ? Math.min(...variantPrices).toFixed(2) : null;
            const max_price = variantPrices.length ? Math.max(...variantPrices).toFixed(2) : null;

            const reviews = scrapeReviews
                ? await fetchReviews(platform, product.id, maxReviewsPerProduct)
                : undefined;

            const average_rating = reviews?.length
                ? Math.round((reviews.reduce((s, r) => s + r.rating, 0) / reviews.length) * 10) / 10
                : null;

            // Shop metadata to attach to every row
            const storeMeta = shopInfo ? {
                store_name: shopInfo.store_name,
                currency: shopInfo.currency,
            } : {};

            if (includeVariants) {
                for (const variant of product.variants) {
                    await Dataset.pushData({
                        record_type: 'product',
                        store_url: storeUrl,
                        ...storeMeta,
                        product_id: product.id,
                        title: product.title,
                        handle: product.handle,
                        vendor: product.vendor,
                        product_type: product.product_type,
                        description,
                        tags: product.tags,
                        product_url: `${storeUrl}/products/${product.handle}`,
                        created_at: product.created_at,
                        updated_at: product.updated_at,
                        published_at: product.published_at,
                        variant_id: variant.id,
                        variant_title: variant.title,
                        sku: variant.sku,
                        price: variant.price,
                        compare_at_price: variant.compare_at_price,
                        discount_percentage: calcDiscountPct(variant.price, variant.compare_at_price),
                        available: variant.available,
                        inventory_quantity: variant.inventory_quantity,
                        images: product.images.map((img) => img.src),
                        reviews,
                        review_count: reviews?.length ?? null,
                        average_rating,
                        scraped_at: new Date().toISOString(),
                    });
                    storedThisPage++;
                }
            } else {
                await Dataset.pushData({
                    record_type: 'product',
                    store_url: storeUrl,
                    ...storeMeta,
                    product_id: product.id,
                    title: product.title,
                    handle: product.handle,
                    vendor: product.vendor,
                    product_type: product.product_type,
                    description,
                    tags: product.tags,
                    price: basePrice,
                    compare_at_price: baseCompareAt,
                    discount_percentage: discountPct,
                    min_price,
                    max_price,
                    available,
                    variants_count: product.variants.length,
                    images: product.images.map((img) => img.src),
                    product_url: `${storeUrl}/products/${product.handle}`,
                    created_at: product.created_at,
                    updated_at: product.updated_at,
                    published_at: product.published_at,
                    reviews,
                    review_count: reviews?.length ?? null,
                    average_rating,
                    scraped_at: new Date().toISOString(),
                });
                storedThisPage++;
            }
        }

        log.info(`[${storeUrl}] Page ${page}: saved ${storedThisPage} items`);

        const limitReached = maxProductsPerStore !== undefined
            && (storeProductCount.get(storeUrl) ?? 0) >= maxProductsPerStore;

        if (products.length === 250 && !limitReached) {
            const nextPage = page + 1;
            await c.addRequests([{
                url: `${storeUrl}/products.json?limit=250&page=${nextPage}`,
                userData: { storeUrl, page: nextPage },
            }]);
        }
    },

    failedRequestHandler({ request }, error) {
        log.error(`Failed: ${request.url}`, { error: String(error) });
    },
});

await crawler.run(startUrls);

log.info('Done.');
await Actor.exit();
