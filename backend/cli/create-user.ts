// Cria um utilizador da equipa (admin ou gestor).
//   npm run user:create -- --name "Erasmo" --email erasmo@exemplo.ao --role admin
// A palavra-passe vem de USER_PASSWORD; se não existir, é gerada e mostrada uma única vez.
import "dotenv/config";
import { parseArgs } from "node:util";
import { closePool, migrate, pool } from "../db.js";
import { randomToken } from "../lib/security.ts";
import { createStaffUser } from "../services/auth.ts";

const { values } = parseArgs({
  options: {
    name: { type: "string" },
    email: { type: "string" },
    phone: { type: "string" },
    role: { type: "string", default: "admin" },
  },
});

try {
  if (!values.name || (!values.email && !values.phone)) throw new Error("Indique --name e --email ou --phone.");
  if (values.role !== "admin" && values.role !== "gestor") throw new Error("--role tem de ser admin ou gestor.");
  const generated = !process.env.USER_PASSWORD;
  const password = process.env.USER_PASSWORD || randomToken(12);
  if (password.length < 10) throw new Error("USER_PASSWORD precisa de pelo menos 10 caracteres.");
  await migrate({ log: () => {} });
  const user = await createStaffUser(pool, { name: values.name, email: values.email, phone: values.phone, role: values.role, password });
  console.log(`Utilizador criado: ${user.name} (${user.role}) ${user.email ?? user.phone}`);
  if (generated) console.log(`Palavra-passe gerada (guarde-a agora, não volta a ser mostrada): ${password}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await closePool();
}
