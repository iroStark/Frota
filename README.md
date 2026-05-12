# UHOCHA Controle de Carros

Aplicativo responsivo para controlar viaturas, motoristas, entregas, despesas, ocorrências e regras do contrato.

## Desenvolvimento local

1. Instalar dependências:

   ```bash
   npm install
   ```

2. Criar `.env` a partir do exemplo:

   ```bash
   cp .env.example .env
   ```

3. Criar a base e aplicar o schema:

   ```bash
   npm run db:setup
   ```

4. Iniciar o servidor:

   ```bash
   npm start
   ```

5. Abrir o app em `http://localhost:3000`.

O backend usa a base `uhocha_controle` e guarda o estado do app em `app_state.payload` como `jsonb`. Cada gravação também cria um histórico em `app_state_audit`. Os ficheiros enviados (fotos, BI, carta, livrete, etc.) ficam em `uploads/` e os metadados em `uploads`.

---

## Deploy no Railway

A app é **um único serviço** (frontend + backend, servidos pelo mesmo Express) + um serviço **Postgres** gerido pelo Railway.

### 1. Criar projeto e Postgres

1. No Railway: **New Project → Deploy from GitHub repo** (ou `railway up` via CLI a partir desta pasta).
2. No mesmo projeto: **+ New → Database → Add PostgreSQL**.

### 2. Variáveis do serviço da app

Em **Variables** do serviço da app, define:

| Variável         | Valor                                    | Notas                                                                 |
| ---------------- | ---------------------------------------- | --------------------------------------------------------------------- |
| `DATABASE_URL`   | `${{Postgres.DATABASE_URL}}`             | Variable Reference para o serviço Postgres do mesmo projeto.          |
| `APP_STATE_ID`   | `main`                                   | Identificador do estado guardado (mantém `main` para uma única conta).|
| `PGSSL`          | *(opcional)* `true`                      | Só necessário se usares a URL **pública** do Postgres.                |
| `UPLOADS_DIR`    | `/data/uploads`                          | Caminho do Volume (passo 3).                                          |
| `NODE_ENV`       | `production`                             |                                                                       |

`PORT` é definido automaticamente pelo Railway — o servidor já o respeita.

### 3. Volume para os uploads

O sistema de ficheiros do contentor é **efémero**. Anexa um Volume para preservar BIs, cartas, fotos e livretes entre deploys:

1. No serviço da app: **Settings → Volumes → + Add Volume**.
2. **Mount path:** `/data/uploads`.
3. Garante que `UPLOADS_DIR=/data/uploads` está nas Variables.

### 4. Build & start

O Railway deteta automaticamente Node.js via Nixpacks. O `railway.toml` deste repo já fixa:

- `startCommand = "npm start"`
- `healthcheckPath = "/api/health"`

O backend executa `migrate()` no arranque (com retry até 10× a cada 2 s), portanto o schema é aplicado automaticamente assim que o Postgres ficar disponível. Não precisas correr `npm run db:setup` no Railway.

### 5. Domínio público

Em **Settings → Networking → Generate Domain** para obter um URL `*.up.railway.app`. O frontend faz pedidos para o mesmo origin, por isso não precisas de configurar CORS.

### Checklist final

- [ ] Variable `DATABASE_URL` referencia o serviço Postgres.
- [ ] Volume montado em `/data/uploads` + `UPLOADS_DIR` definido.
- [ ] Healthcheck `/api/health` devolve `200`.
- [ ] Abrir o domínio, registar uma viatura/motorista, confirmar que os uploads persistem após restart.

---

## Estrutura

```
backend/
  server.js      # Express + multer + estáticos + SPA fallback
  db.js          # Pool pg (SSL auto)
  schema.sql     # esquema idempotente, executado no arranque
  migrate.js     # CLI manual: npm run db:migrate
  create-db.js   # CLI manual: npm run db:create (uso local)
app.js           # frontend SPA (sem build, ES modules nativos)
index.html
styles.css
sw.js            # service worker (network-first em JS/CSS)
uploads/         # local apenas; em produção usa Volume
railway.toml     # config Railway
```
