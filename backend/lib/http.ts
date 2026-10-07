import type { NextFunction, Request, RequestHandler, Response } from "express";
import { type ZodType, z } from "zod";
import type { AccessClaims } from "./security.ts";

export class HttpError extends Error {
  status: number;
  code: string;
  details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export type AuthedRequest = Request & { user: AccessClaims };

/** Envolve handlers async para que erros cheguem ao middleware de erros do Express. */
export function route(handler: (request: AuthedRequest, response: Response) => Promise<unknown>): RequestHandler {
  return (request: Request, response: Response, next: NextFunction) => {
    handler(request as AuthedRequest, response).catch(next);
  };
}

export function parse<T>(schema: ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new HttpError(422, "validacao", "Dados inválidos.", z.flattenError(result.error));
  }
  return result.data;
}

export function errorHandler(error: unknown, _request: Request, response: Response, _next: NextFunction) {
  if (error instanceof HttpError) {
    response.status(error.status).json({ error: error.message, code: error.code, details: error.details });
    return;
  }
  const pgError = error as { code?: string; constraint?: string };
  if (pgError?.code === "23505") {
    response.status(409).json({ error: "Registo duplicado.", code: "duplicado", details: pgError.constraint });
    return;
  }
  if (pgError?.code === "23503" || pgError?.code === "23514") {
    response.status(422).json({ error: "Dados inconsistentes.", code: "restricao", details: pgError.constraint });
    return;
  }
  console.error(error);
  response.status(500).json({ error: "Erro interno do servidor.", code: "interno" });
}
