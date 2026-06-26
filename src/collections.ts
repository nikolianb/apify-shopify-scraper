import { log } from 'crawlee';

interface RawCollection {
    id: number;
    handle: string;
    title: string;
    body_html?: string;
    image?: { src: string };
    products_count?: number;
}

export interface ShopifyCollection {
    collection_id: number;
    title: string;
    handle: string;
    description: string | null;
    image_url: string | null;
    products_count: number | null;
    collection_url: string;
}

function stripHtml(html: string): string {
    return html.replace(/<[^>]+>/g, '').trim();
}

export async function fetchCollections(storeUrl: string): Promise<ShopifyCollection[]> {
    const collections: ShopifyCollection[] = [];
    let page = 1;

    while (true) {
        try {
            const url = `${storeUrl}/collections.json?limit=250&page=${page}`;
            const res = await fetch(url, { headers: { Accept: 'application/json' } });
            if (!res.ok) {
                log.warning(`Collections endpoint returned ${res.status} for ${storeUrl}`);
                break;
            }

            const data = await res.json() as { collections?: RawCollection[] };
            const batch = data.collections ?? [];
            if (!batch.length) break;

            for (const c of batch) {
                collections.push({
                    collection_id: c.id,
                    title: c.title,
                    handle: c.handle,
                    description: c.body_html ? (stripHtml(c.body_html) || null) : null,
                    image_url: c.image?.src ?? null,
                    products_count: c.products_count ?? null,
                    collection_url: `${storeUrl}/collections/${c.handle}`,
                });
            }

            if (batch.length < 250) break;
            page++;
        } catch (err) {
            log.error(`Failed to fetch collections page ${page} for ${storeUrl}: ${String(err)}`);
            break;
        }
    }

    return collections;
}
