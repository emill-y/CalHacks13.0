/** Fixed category list used in catalog, labels and merchant forms. */
export const CATEGORIES = ["Top", "Blouse", "Shirt", "T-shirt", "Dress", "Skirt", "Trousers", "Jeans", "Jacket", "Knitwear"] as const;
export type Category = (typeof CATEGORIES)[number];
