// API v1 (app Flutter). Montada em /api/v1 pelo server.js, em paralelo com a API do PWA.
import express, { Router } from "express";
import { HttpError, errorHandler } from "../lib/http.ts";
import { applyLatePenalties, generateWeeklyCharges } from "../services/billing.ts";
import { syncIncidentStates } from "../services/fleet.ts";
import { authenticate, requireRole, withTransaction } from "./context.ts";
import { registerAccountRoutes, registerPublicAuthRoutes } from "./routes/auth.ts";
import { registerDashboardRoutes } from "./routes/dashboard.ts";
import { registerFileRoutes } from "./routes/files.ts";
import { registerFinanceRoutes } from "./routes/finance.ts";
import { registerFleetRoutes } from "./routes/fleet.ts";
import { registerOperationRoutes } from "./routes/operations.ts";
import { registerSyncRoutes } from "./routes/sync.ts";
import { route } from "../lib/http.ts";

export { withTransaction } from "./context.ts";

export function createV1Router(): Router {
  const router = Router();
  router.use(express.json({ limit: "1mb" }));
  registerPublicAuthRoutes(router);

  router.use(authenticate);
  registerAccountRoutes(router);
  registerDashboardRoutes(router);
  registerFleetRoutes(router);
  registerFileRoutes(router);
  registerOperationRoutes(router);
  registerFinanceRoutes(router);
  registerSyncRoutes(router);

  router.post("/admin/jobs/billing", requireRole("admin"), route(async (_request, response) => {
    response.json(await runBillingJobs(new Date()));
  }));

  router.use((_request, _response, next) => next(new HttpError(404, "nao_encontrado", "Rota inexistente.")));
  router.use(errorHandler);
  return router;
}

const BILLING_LOCK_ID = 727275;

/**
 * Avança ocorrências com o tempo, gera cobranças em falta e penalidades.
 * Seguro de correr em várias instâncias (advisory lock).
 */
export async function runBillingJobs(now: Date) {
  return withTransaction(async (db) => {
    const lock = await db.query("SELECT pg_try_advisory_xact_lock($1) AS ok", [BILLING_LOCK_ID]);
    if (!lock.rows[0].ok) return { skipped: true as const };
    const incidents = await syncIncidentStates(db, now);
    const charges = await generateWeeklyCharges(db, now);
    const penalties = await applyLatePenalties(db, now);
    return {
      skipped: false as const,
      incidentsChanged: incidents.changed,
      chargesCreated: charges.created,
      penaltiesChanged: penalties.changed,
      breaches: penalties.breaches,
    };
  });
}
