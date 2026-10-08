// Dados de demonstração para desenvolvimento da app (NUNCA em produção).
//   createdb uhocha_demo && DATABASE_URL=postgresql://localhost:5432/uhocha_demo npm run seed:demo
// Credenciais de demonstração (só existem nesta base local):
//   admin   demo.admin@uhocha.test  / demo-admin-2026
//   gestor  demo.gestor@uhocha.test / demo-gestor-2026
//   motorista: telefone 923000101, ativar com o código impresso no fim.
import "dotenv/config";
import { closePool, migrate, pool } from "../db.js";
import { addDays, localDateOf, weekStartOf } from "../domain/time.ts";
import { createStaffUser, inviteDriver } from "../services/auth.ts";
import { generateWeeklyCharges, applyLatePenalties, recordPayment } from "../services/billing.ts";
import { applyIncidentEffects, assignVehicle } from "../services/fleet.ts";

const url = new URL(process.env.DATABASE_URL || "postgresql://localhost:5432/uhocha_controle");
if (process.env.NODE_ENV === "production" || !["localhost", "127.0.0.1", "::1"].includes(url.hostname)) {
  console.error("seed:demo só corre contra uma base local e fora de produção.");
  process.exit(1);
}

const at = (day: string, time: string) => `${day}T${time}:00+01:00`;

try {
  await migrate({ log: () => {} });
  const existing = await pool.query("SELECT 1 FROM users WHERE email = 'demo.admin@uhocha.test'");
  if (existing.rowCount) throw new Error("Esta base já tem os dados de demonstração.");

  const client = await pool.connect();
  let code = "";
  try {
    await client.query("BEGIN");
    const admin = await createStaffUser(client, { name: "Erasmo Samba", email: "demo.admin@uhocha.test", role: "admin", password: "demo-admin-2026" });
    await createStaffUser(client, { name: "Gestora Demo", email: "demo.gestor@uhocha.test", role: "gestor", password: "demo-gestor-2026" });

    const today = localDateOf(Date.now(), 60);
    const thisWeek = weekStartOf(today);
    const insert = async (sql: string, params: unknown[]) => (await client.query(sql, params)).rows[0].id as string;

    const vehicles = [
      await insert("INSERT INTO vehicles (brand, model, plate, year, color) VALUES ('Suzuki', 'Express', 'HL-10-01-AA', 2023, 'Branco') RETURNING id", []),
      await insert("INSERT INTO vehicles (brand, model, plate, year, color) VALUES ('Toyota', 'Hiace', 'HL-20-02-BB', 2021, 'Azul') RETURNING id", []),
      await insert("INSERT INTO vehicles (brand, model, plate, year, color) VALUES ('Suzuki', 'Every', 'HL-30-03-CC', 2022, 'Branco') RETURNING id", []),
      await insert("INSERT INTO vehicles (brand, model, plate, year, color) VALUES ('Hyundai', 'H-1', 'HL-40-04-DD', 2019, 'Cinzento') RETURNING id", []),
    ];
    const drivers = [
      await insert("INSERT INTO drivers (name, phone, deposit) VALUES ('João Manuel', '+244923000101', 50000) RETURNING id", []),
      await insert("INSERT INTO drivers (name, phone, deposit) VALUES ('Pedro Afonso', '+244923000102', 50000) RETURNING id", []),
      await insert("INSERT INTO drivers (name, phone, deposit) VALUES ('Carlos Neto', '+244923000103', 50000) RETURNING id", []),
    ];
    await client.query(
      "INSERT INTO driver_contacts (driver_id, name, relation, phone) VALUES ($1, 'Ana Manuel', 'esposa', '+244923999101')",
      [drivers[0]],
    );
    await client.query(
      "INSERT INTO documents (owner_type, owner_id, type, number, valid_until) VALUES ('driver', $1, 'carta_conducao', 'LD-123456', $2), ('driver', $3, 'bilhete_identidade', '000123456LA041', $4)",
      [drivers[0], addDays(today, 12), drivers[1], addDays(today, -3)],
    );

    const starts = [addDays(thisWeek, -25), addDays(thisWeek, -18), addDays(thisWeek, -11)];
    for (const [index, driverId] of drivers.entries()) {
      await assignVehicle(client, { vehicleId: vehicles[index], driverId, startAt: at(starts[index], "08:00"), depositReceived: 50000, handover: { mileage: 10000 + index * 5000, fuelLevel: "meio" } }, admin.id);
    }
    // Oficina de 2 dias para o Pedro na semana passada.
    const incident = await insert(
      `INSERT INTO incidents (type, vehicle_id, driver_id, start_at, end_at, status, exempts_fee, validated_at, notes)
       VALUES ('manutencao', $1, $2, $3, $4, 'resolvida', true, now(), 'Troca de embraiagem') RETURNING id`,
      [vehicles[1], drivers[1], at(addDays(thisWeek, -5), "07:00"), at(addDays(thisWeek, -4), "21:00")],
    );
    await applyIncidentEffects(client, incident);

    const now = new Date();
    await generateWeeklyCharges(client, now);
    // João paga tudo a tempo; Carlos paga uma semana com atraso; Pedro está em dívida.
    const joao = await client.query("SELECT due_at, amount FROM charges WHERE driver_id = $1 AND kind = 'semanal' ORDER BY due_at", [drivers[0]]);
    for (const charge of joao.rows) {
      await recordPayment(client, { driverId: drivers[0], amount: Number(charge.amount), receivedAt: new Date(charge.due_at.getTime() - 3_600_000).toISOString(), method: "transferencia", reference: "TRF" }, admin.id);
    }
    const carlos = await client.query("SELECT due_at, amount FROM charges WHERE driver_id = $1 AND kind = 'semanal' ORDER BY due_at LIMIT 1", [drivers[2]]);
    if (carlos.rowCount) {
      await recordPayment(client, { driverId: drivers[2], amount: Number(carlos.rows[0].amount), receivedAt: new Date(carlos.rows[0].due_at.getTime() + 20 * 3_600_000).toISOString(), method: "numerario" }, admin.id);
    }
    await applyLatePenalties(client, now);
    await client.query(
      "INSERT INTO expenses (vehicle_id, category, responsible, amount, spent_on, supplier) VALUES ($1, 'manutencao', 'proprietaria', 85000, $2, 'Oficina Central')",
      [vehicles[1], addDays(thisWeek, -4)],
    );
    code = (await inviteDriver(client, drivers[0])).code;
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  console.log("Dados de demonstração criados (credenciais no topo de backend/cli/seed-demo.ts).");
  console.log(`Código de ativação do motorista 923000101: ${code}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await closePool();
}
