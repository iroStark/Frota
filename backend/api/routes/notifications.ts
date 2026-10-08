import type { Router } from "express";
import { z } from "zod";
import { pool } from "../../db.js";
import { parse, route } from "../../lib/http.ts";
import { uuid } from "../context.ts";

export function registerNotificationRoutes(router: Router) {
  router.get("/me/notifications", route(async (request, response) => {
    const result = await pool.query(
      `SELECT id, kind, payload, read_at, created_at FROM notifications WHERE user_id = $1
       ORDER BY created_at DESC LIMIT 50`,
      [request.user.sub],
    );
    const unread = await pool.query("SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND read_at IS NULL", [request.user.sub]);
    response.json({
      unread: unread.rows[0].n,
      items: result.rows.map((row) => ({ id: row.id, kind: row.kind, ...row.payload, readAt: row.read_at, createdAt: row.created_at })),
    });
  }));

  router.post("/me/notifications/read", route(async (request, response) => {
    const body = parse(z.object({ ids: z.array(uuid).max(200).optional() }), request.body ?? {});
    await pool.query(
      `UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL AND ($2::uuid[] IS NULL OR id = ANY($2))`,
      [request.user.sub, body.ids ?? null],
    );
    response.json({ ok: true });
  }));

  router.post("/me/devices", route(async (request, response) => {
    const body = parse(z.object({ token: z.string().min(20).max(4096), platform: z.enum(["ios", "android"]) }), request.body);
    await pool.query(
      `INSERT INTO device_tokens (token, user_id, platform) VALUES ($1, $2, $3)
       ON CONFLICT (token) DO UPDATE SET user_id = EXCLUDED.user_id, platform = EXCLUDED.platform, last_seen_at = now()`,
      [body.token, request.user.sub, body.platform],
    );
    response.json({ ok: true });
  }));

  router.delete("/me/devices/:token", route(async (request, response) => {
    await pool.query("DELETE FROM device_tokens WHERE token = $1 AND user_id = $2", [request.params.token, request.user.sub]);
    response.status(204).end();
  }));
}
