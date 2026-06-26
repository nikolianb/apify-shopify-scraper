import { log } from 'crawlee';

// Public config extracted from store homepage per platform
export type ReviewPlatform =
    | { type: 'judgeme'; shopDomain: string }
    | { type: 'yotpo'; appKey: string }
    | { type: 'stamped'; apiKey: string; storeUrl: string }
    | { type: 'okendo'; subscriberId: string }
    | { type: 'loox'; shopDomain: string }
    | null;

export interface Review {
    platform: string;
    author: string;
    rating: number;
    title: string | null;
    body: string;
    date: string;
    verified: boolean;
    helpful_votes?: number;
    photos?: string[];
}

function extractFromHtml(html: string, patterns: RegExp[]): string | null {
    for (const pattern of patterns) {
        const match = html.match(pattern);
        if (match?.[1]) return match[1];
    }
    return null;
}

export async function detectReviewPlatform(storeUrl: string): Promise<ReviewPlatform> {
    try {
        const res = await fetch(storeUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1)' },
        });
        const html = await res.text();
        const domain = new URL(storeUrl).hostname;

        if (html.includes('cdn.judge.me') || html.includes('judge.me/')) {
            return { type: 'judgeme', shopDomain: domain };
        }

        if (html.includes('yotpo.com')) {
            const appKey = extractFromHtml(html, [
                /['"]appKey['"]\s*:\s*['"]([^'"]{10,})['"]/i,
                /['"]app_key['"]\s*:\s*['"]([^'"]{10,})['"]/i,
                /data-app-key="([^"]+)"/,
            ]);
            if (appKey) return { type: 'yotpo', appKey };
        }

        if (html.includes('stamped.io')) {
            const apiKey = extractFromHtml(html, [
                /data-api-key="([^"]+)"/,
                /['"]apiKey['"]\s*:\s*['"]([a-zA-Z0-9-_]+)['"]/,
                /pubkey['"]\s*:\s*['"]([^'"]+)['"]/i,
            ]);
            if (apiKey) return { type: 'stamped', apiKey, storeUrl };
        }

        if (html.includes('okendo.io')) {
            const subscriberId = extractFromHtml(html, [
                /subscriberId['"]\s*:\s*['"]([^'"]+)['"]/i,
                /data-subscriber-id="([^"]+)"/,
                /okendo.*?id['"]\s*:\s*['"]([a-f0-9-]{30,})['"]/i,
            ]);
            if (subscriberId) return { type: 'okendo', subscriberId };
        }

        if (html.includes('loox.io')) {
            return { type: 'loox', shopDomain: domain };
        }
    } catch (err) {
        log.warning(`Review platform detection failed for ${storeUrl}: ${String(err)}`);
    }
    return null;
}

// ------- Judge.me -------

async function fetchJudgeMeReviews(shopDomain: string, productId: number, max: number): Promise<Review[]> {
    const reviews: Review[] = [];
    const perPage = Math.min(max, 25);
    let page = 1;

    while (reviews.length < max) {
        const url = `https://judge.me/api/v1/reviews?shop_domain=${shopDomain}&product_external_id=${productId}&per_page=${perPage}&page=${page}&api_token=`;
        const res = await fetch(url, { headers: { Accept: 'application/json' } });
        if (!res.ok) break;

        const data = await res.json() as {
            reviews?: Array<{
                reviewer: { name: string };
                rating: number;
                title?: string;
                body: string;
                created_at: string;
                verified?: boolean;
                helpful_count?: number;
                pictures?: Array<{ urls: { original: string } }>;
            }>;
        };

        const batch = data.reviews ?? [];
        if (!batch.length) break;

        for (const r of batch) {
            if (reviews.length >= max) break;
            reviews.push({
                platform: 'judgeme',
                author: r.reviewer?.name ?? 'Anonymous',
                rating: r.rating,
                title: r.title ?? null,
                body: r.body ?? '',
                date: r.created_at,
                verified: r.verified ?? false,
                helpful_votes: r.helpful_count,
                photos: r.pictures?.map((p) => p.urls?.original).filter(Boolean),
            });
        }

        if (batch.length < perPage) break;
        page++;
    }

    return reviews;
}

// ------- Yotpo -------

async function fetchYotpoReviews(appKey: string, productId: number, max: number): Promise<Review[]> {
    const reviews: Review[] = [];
    const perPage = Math.min(max, 150);
    let page = 1;

    while (reviews.length < max) {
        const url = `https://api-cdn.yotpo.com/v1/widget/${appKey}/products/${productId}/reviews.json?per_page=${perPage}&page=${page}`;
        const res = await fetch(url, { headers: { Accept: 'application/json' } });
        if (!res.ok) break;

        const data = await res.json() as {
            response?: {
                reviews?: Array<{
                    user: { display_name: string };
                    score: number;
                    title?: string;
                    content: string;
                    created_at: string;
                    verified_buyer?: boolean;
                    votes_up?: number;
                    imagesData?: Array<{ thumb_url: string }>;
                }>;
            };
        };

        const batch = data.response?.reviews ?? [];
        if (!batch.length) break;

        for (const r of batch) {
            if (reviews.length >= max) break;
            reviews.push({
                platform: 'yotpo',
                author: r.user?.display_name ?? 'Anonymous',
                rating: r.score,
                title: r.title ?? null,
                body: r.content ?? '',
                date: r.created_at,
                verified: r.verified_buyer ?? false,
                helpful_votes: r.votes_up,
                photos: r.imagesData?.map((img) => img.thumb_url).filter(Boolean),
            });
        }

        if (batch.length < perPage) break;
        page++;
    }

    return reviews;
}

// ------- Stamped.io -------

async function fetchStampedReviews(
    apiKey: string,
    storeUrl: string,
    productId: number,
    max: number,
): Promise<Review[]> {
    const reviews: Review[] = [];
    const take = Math.min(max, 25);
    const domain = new URL(storeUrl).hostname;
    let page = 1;

    while (reviews.length < max) {
        const url = `https://stamped.io/api/widget?apiKey=${apiKey}&storeUrl=${domain}&productId=${productId}&take=${take}&page=${page}`;
        const res = await fetch(url, { headers: { Accept: 'application/json' } });
        if (!res.ok) break;

        const data = await res.json() as {
            data?: Array<{
                author?: string;
                reviewRating: number;
                reviewTitle?: string;
                reviewMessage: string;
                dateCreated: string;
                reviewVerifiedType?: number;
            }>;
        };

        const batch = data.data ?? [];
        if (!batch.length) break;

        for (const r of batch) {
            if (reviews.length >= max) break;
            reviews.push({
                platform: 'stamped',
                author: r.author ?? 'Anonymous',
                rating: r.reviewRating,
                title: r.reviewTitle ?? null,
                body: r.reviewMessage ?? '',
                date: r.dateCreated,
                verified: (r.reviewVerifiedType ?? 0) > 0,
            });
        }

        if (batch.length < take) break;
        page++;
    }

    return reviews;
}

// ------- Okendo -------
// Okendo uses cursor-based pagination via nextUrl

async function fetchOkendoReviews(subscriberId: string, productId: number, max: number): Promise<Review[]> {
    const reviews: Review[] = [];
    const limit = Math.min(max, 50);
    let nextUrl: string | null =
        `https://api.okendo.io/v1/stores/${subscriberId}/products/${productId}/reviews?limit=${limit}&offset=0`;

    while (reviews.length < max && nextUrl) {
        const res = await fetch(nextUrl, { headers: { Accept: 'application/json' } });
        if (!res.ok) break;

        const data = await res.json() as {
            nextUrl?: string;
            reviews?: Array<{
                reviewer: { displayName: string; isVerified?: boolean };
                rating: number;
                title?: string;
                headline?: string;
                body: string;
                dateCreated: string;
                helpfulCount?: number;
                media?: Array<{ url: string }>;
            }>;
        };

        const batch = data.reviews ?? [];
        if (!batch.length) break;

        for (const r of batch) {
            if (reviews.length >= max) break;
            reviews.push({
                platform: 'okendo',
                author: r.reviewer?.displayName ?? 'Anonymous',
                rating: r.rating,
                title: r.headline ?? r.title ?? null,
                body: r.body ?? '',
                date: r.dateCreated,
                verified: r.reviewer?.isVerified ?? false,
                helpful_votes: r.helpfulCount,
                photos: r.media?.map((m) => m.url).filter(Boolean),
            });
        }

        nextUrl = data.nextUrl ? `https://api.okendo.io${data.nextUrl}` : null;
    }

    return reviews;
}

// ------- Loox -------

async function fetchLooxReviews(shopDomain: string, productId: number, max: number): Promise<Review[]> {
    const reviews: Review[] = [];
    const perPage = Math.min(max, 30);
    let page = 1;

    while (reviews.length < max) {
        const url = `https://loox.io/api/reviews/product?product_id=${productId}&shop=${shopDomain}&page=${page}&per_page=${perPage}`;
        const res = await fetch(url, { headers: { Accept: 'application/json' } });
        if (!res.ok) break;

        const data = await res.json() as {
            reviews?: Array<{
                reviewer_name?: string;
                rating: number;
                title?: string;
                body: string;
                created_at: string;
                verified?: boolean;
                photo_url?: string;
            }>;
        };

        const batch = data.reviews ?? [];
        if (!batch.length) break;

        for (const r of batch) {
            if (reviews.length >= max) break;
            reviews.push({
                platform: 'loox',
                author: r.reviewer_name ?? 'Anonymous',
                rating: r.rating,
                title: r.title ?? null,
                body: r.body ?? '',
                date: r.created_at,
                verified: r.verified ?? false,
                photos: r.photo_url ? [r.photo_url] : [],
            });
        }

        if (batch.length < perPage) break;
        page++;
    }

    return reviews;
}

// ------- Main dispatcher -------

export async function fetchReviews(
    platform: ReviewPlatform,
    productId: number,
    maxReviews: number,
): Promise<Review[]> {
    if (!platform) return [];

    try {
        switch (platform.type) {
            case 'judgeme':
                return fetchJudgeMeReviews(platform.shopDomain, productId, maxReviews);
            case 'yotpo':
                return fetchYotpoReviews(platform.appKey, productId, maxReviews);
            case 'stamped':
                return fetchStampedReviews(platform.apiKey, platform.storeUrl, productId, maxReviews);
            case 'okendo':
                return fetchOkendoReviews(platform.subscriberId, productId, maxReviews);
            case 'loox':
                return fetchLooxReviews(platform.shopDomain, productId, maxReviews);
        }
    } catch (err) {
        log.warning(`Review fetch failed for product ${productId}: ${String(err)}`);
    }
    return [];
}
