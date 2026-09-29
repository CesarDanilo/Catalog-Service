import { z } from 'zod';

/**
 * Formato da resposta da SerpApi (engine google_shopping) — só os campos usados.
 * Cada campo é tolerante (`.catch(undefined)`): um valor com tipo inesperado vira ausente
 * em vez de descartar o item inteiro.
 */
const optionalString = z.string().optional().catch(undefined);
const optionalNumber = z.number().optional().catch(undefined);

export const serpApiShoppingResultSchema = z.object({
  position: optionalNumber,
  product_id: z.union([z.string(), z.number()]).optional().catch(undefined),
  title: optionalString,
  price: optionalString,
  extracted_price: optionalNumber,
  thumbnail: optionalString,
  product_link: optionalString,
  link: optionalString,
  source: optionalString,
  rating: optionalNumber,
  reviews: optionalNumber,
});

const resultList = z.array(z.unknown()).optional().catch(undefined);

export const serpApiShoppingResponseSchema = z.object({
  error: optionalString,
  search_metadata: z.object({ status: optionalString }).optional(),
  shopping_results: resultList,
  /** Layout novo do Google Shopping: resultados agrupados por categoria. */
  categorized_shopping_results: z
    .array(z.object({ shopping_results: resultList }).catch({ shopping_results: undefined }))
    .optional()
    .catch(undefined),
});

export type SerpApiShoppingResult = z.infer<typeof serpApiShoppingResultSchema>;
