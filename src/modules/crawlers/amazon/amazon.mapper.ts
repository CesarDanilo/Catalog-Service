import type { ScrapedProduct } from '../crawler.types.js';
import type { AmazonCatalogItem } from './amazon.parser.js';

export function mapAmazonItem(item: AmazonCatalogItem): ScrapedProduct {
  return {
    externalId: item.asin,
    name: item.title,
    brand: item.brand,
    category: item.category,
    color: item.color,
    size: item.size,
    price: item.price,
    originalPrice: item.listPrice,
    currency: item.currency,
    imageUrl: item.imageUrls[0],
    images: item.imageUrls,
    productUrl: item.detailPageUrl,
    available: item.available,
    rawData: item,
  };
}
