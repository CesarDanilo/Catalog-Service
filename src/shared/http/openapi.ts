import { z } from 'zod';

type JsonSchema = Record<string, unknown>;

/**
 * Converte um schema Zod em JSON Schema para a documentação OpenAPI.
 * A validação real acontece com Zod nos controllers; o JSON Schema é apenas documentação.
 */
export function toJsonSchema(schema: z.ZodType, io: 'input' | 'output' = 'input'): JsonSchema {
  const { $schema: _ignored, ...jsonSchema } = z.toJSONSchema(schema, {
    io,
    target: 'draft-7',
    unrepresentable: 'any',
  }) as JsonSchema;
  return jsonSchema;
}

export const errorResponseSchema = {
  type: 'object',
  properties: {
    error: {
      type: 'object',
      properties: {
        code: { type: 'string', examples: ['PRODUCT_NOT_FOUND'] },
        message: { type: 'string', examples: ['Product not found'] },
        details: {},
      },
      required: ['code', 'message'],
    },
  },
  required: ['error'],
} as const;

export function errorResponses(...statusCodes: number[]): Record<number, unknown> {
  const descriptions: Record<number, string> = {
    400: 'Parâmetros inválidos',
    404: 'Recurso não encontrado',
    409: 'Conflito com o estado atual do recurso',
    429: 'Limite de requisições excedido',
    500: 'Erro interno',
  };
  return Object.fromEntries(
    statusCodes.map((code) => [
      code,
      { description: descriptions[code] ?? 'Erro', ...errorResponseSchema },
    ]),
  );
}
