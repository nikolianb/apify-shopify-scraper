# Shopify Store Scraper

Extract complete product data from any Shopify store — prices, variants, inventory, reviews, collections, currency, and more. Works on any store powered by Shopify including custom domains. No browser required. Fast, cheap, and reliable.

## Features

- Scrapes **any Shopify store** by URL — no template or configuration needed
- Extracts full product catalog with descriptions, variants, images, and tags
- **Store metadata** — store name, currency, country auto-detected per store
- **Price range** — `min_price` and `max_price` across all variants
- **Discount percentage** calculated automatically from compare-at price
- **Product timestamps** — `created_at`, `updated_at`, `published_at`
- **Reviews** — auto-detects and scrapes from Judge.me, Yotpo, Stamped.io, Okendo, and Loox
- **Average rating** computed from fetched reviews
- **Collections/categories** — scrapes store collection hierarchy
- **Filters** — only available products, minimum discount %, created after date
- Option to output each **variant as a separate row** (great for price sheets)
- Handles pagination — scrapes the full catalog regardless of size
- No browser, no credentials required
- Pay Per Event pricing — you only pay per product scraped

## Use cases

- **Price monitoring** — track competitor prices and sale discounts across Shopify stores
- **Dropshipping research** — products, reviews, and availability in one run
- **Market research** — analyze catalogs, categories, pricing trends, and review sentiment
- **Inventory tracking** — monitor stock and availability changes over time
- **Discount hunting** — filter to only products on sale above a threshold

## Input

| Field | Type | Required | Description |
|---|---|---|---|
| `storeUrls` | Array of strings | Yes | Shopify store URLs (e.g. `https://allbirds.com`) |
| `maxProductsPerStore` | Integer | No | Max products per store (default: unlimited) |
| `includeVariants` | Boolean | No | Output each variant as a separate row (default: false) |
| `scrapeReviews` | Boolean | No | Fetch product reviews (default: false) |
| `maxReviewsPerProduct` | Integer | No | Max reviews per product (default: 50, max: 1000) |
| `scrapeCollections` | Boolean | No | Scrape store collections/categories (default: false) |
| `onlyAvailable` | Boolean | No | Skip products where all variants are out of stock (default: false) |
| `minDiscount` | Integer | No | Only return products discounted by at least this % (1–99) |
| `createdAfter` | String | No | Only return products created after this date (YYYY-MM-DD) |
| `proxyConfig` | Object | No | Proxy settings (datacenter proxies work fine) |

## Output — Products

```json
{
  "record_type": "product",
  "store_url": "https://allbirds.com",
  "store_name": "Allbirds",
  "currency": "USD",
  "product_id": 1234567890,
  "title": "Tree Runner",
  "handle": "tree-runner",
  "vendor": "Allbirds",
  "product_type": "Footwear",
  "description": "Made from eucalyptus tree fiber...",
  "tags": ["sustainable", "running"],
  "price": "98.00",
  "compare_at_price": "135.00",
  "discount_percentage": 27,
  "min_price": "78.00",
  "max_price": "118.00",
  "available": true,
  "variants_count": 8,
  "images": ["https://cdn.shopify.com/..."],
  "product_url": "https://allbirds.com/products/tree-runner",
  "created_at": "2023-01-15T08:00:00-05:00",
  "updated_at": "2026-06-01T12:00:00-05:00",
  "published_at": "2023-01-15T10:00:00-05:00",
  "reviews": [
    {
      "platform": "judgeme",
      "author": "Jane D.",
      "rating": 5,
      "title": "Best shoes I've ever owned",
      "body": "Super comfortable right out of the box...",
      "date": "2026-05-01T00:00:00Z",
      "verified": true,
      "helpful_votes": 12,
      "photos": []
    }
  ],
  "review_count": 1,
  "average_rating": 4.8,
  "scraped_at": "2026-06-26T10:00:00.000Z"
}
```

### With `includeVariants: true`

Each variant becomes its own row with all product fields plus:

```json
{
  "variant_id": 9876543210,
  "variant_title": "US 10 / Gray",
  "sku": "TR-US10-GRY",
  "price": "98.00",
  "compare_at_price": "135.00",
  "discount_percentage": 27,
  "available": true,
  "inventory_quantity": 14
}
```

## Output — Collections (when `scrapeCollections: true`)

```json
{
  "record_type": "collection",
  "store_url": "https://allbirds.com",
  "collection_id": 987654321,
  "title": "Men's Shoes",
  "handle": "mens-shoes",
  "description": "Shop all men's shoes...",
  "image_url": "https://cdn.shopify.com/...",
  "products_count": 24,
  "collection_url": "https://allbirds.com/collections/mens-shoes"
}
```

## Supported review platforms

| Platform | Detection |
|---|---|
| Judge.me | Auto-detected from page source |
| Yotpo | Auto-detected, extracts public app key |
| Stamped.io | Auto-detected, extracts public API key |
| Okendo | Auto-detected, extracts subscriber ID |
| Loox | Auto-detected from page source |

## How it works

Uses Shopify's public `/products.json` and `/collections.json` endpoints — available on every Shopify store without credentials. Paginates with `limit=250` until the full catalog is retrieved. Store currency and name are auto-detected via `/shop.json` (with an HTML fallback for stores that block it). Reviews are fetched from the platform's public CDN API after detecting which review app the store uses.
