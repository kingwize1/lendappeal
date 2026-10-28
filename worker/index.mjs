// Cloudflare Worker: the order/invoice API. Bundled with the product catalog so prices are always re-derived server-side.
import products from '../data/products.json';
import siteData from '../data/site.json';
import { createApi } from '../lib/orders.mjs';

export default {
  fetch(request, env) {
    const site = { ...siteData, siteUrl: (env.SITE_URL || siteData.siteUrl).replace(/\/$/, '') };
    return createApi({ env, products, site }).handle(request);
  },
};
