// Importar PRIMEIRO num ficheiro *.it.ts: cria uma base de dados própria para esse ficheiro
// (uhocha_it_<nome>) e aponta DATABASE_URL para ela antes de db.js ser carregado.
// Síncrono de propósito: um await de topo não impediria os outros imports de avaliar primeiro.
import { execFileSync } from "node:child_process";
import { basename } from "node:path";

const base = new URL(process.env.TEST_DATABASE_URL || "postgresql://localhost:5432/postgres");
const script = basename(process.argv[1] ?? "teste").replace(/\.it\.ts$/, "").replace(/[^a-z0-9]/gi, "_").toLowerCase();
const name = `uhocha_it_${script}`;

const connection = ["-h", base.hostname, "-p", base.port || "5432", ...(base.username ? ["-U", decodeURIComponent(base.username)] : [])];
const env = { ...process.env, ...(base.password ? { PGPASSWORD: decodeURIComponent(base.password) } : {}) };
execFileSync("dropdb", [...connection, "--if-exists", "--force", name], { env, stdio: "ignore" });
execFileSync("createdb", [...connection, name], { env, stdio: "inherit" });

const target = new URL(base);
target.pathname = `/${name}`;
process.env.DATABASE_URL = target.toString();
process.env.JWT_SECRET ??= "segredo-de-teste";
process.env.UPLOADS_DIR ??= `${process.env.TMPDIR ?? "/tmp"}/uhocha-it-uploads`;
