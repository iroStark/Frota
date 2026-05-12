import { closePool, migrate } from "./db.js";

try {
  await migrate();
  console.log("Database schema is ready.");
} finally {
  await closePool();
}
