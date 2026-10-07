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

Em desenvolvimento, sem `APP_ACCESS_KEY` no `.env`, a API fica aberta (aviso no arranque). Para testar o ecrã de entrada, define `APP_ACCESS_KEY`.

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
| `APP_ACCESS_KEY` | *(frase longa e secreta)*                | **Obrigatória.** Chave pedida no ecrã de entrada. Sem ela, em produção a API recusa todos os pedidos (503). |
| `SESSION_SECRET` | *(opcional, valor aleatório)*            | Assina os cookies de sessão. Mudar este valor termina todas as sessões. |
| `CORS_ORIGINS`   | *(opcional)*                             | Só se o frontend for servido noutro domínio (lista separada por vírgulas). |

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
  db.js          # Pool pg (SSL auto) + executor de migrações versionadas
  auth.js        # chave de acesso / sessão (Fase 0)
  backup.js      # npm run db:backup
  migrations/    # NNN_nome.sql, aplicadas por ordem no arranque (tabela schema_migrations)
  domain/        # regras de negócio puras em TypeScript (motor de cobranças) + testes
  import/        # importação do estado JSON antigo para as tabelas normalizadas
  migrate.js     # CLI manual: npm run db:migrate
  create-db.js   # CLI manual: npm run db:create (uso local)
app.js           # frontend SPA (sem build, ES modules nativos)
index.html
styles.css
sw.js            # service worker (network-first em JS/CSS)
uploads/         # local apenas; em produção usa Volume
railway.toml     # config Railway
```

## Desenvolvimento do backend v1 (Fase 2)

- Requer Node ≥ 22.18 (executa `.ts` diretamente, sem compilação).
- `npm test` — testes do motor de cobranças e do importador.
- `npm run typecheck` — verificação de tipos.
- `npm run test:integration` — testes da API v1 contra Postgres local (recria a base `uhocha_it`).
- `npm run user:create -- --name "Nome" --email x@y.ao --role admin` — cria o primeiro administrador (palavra-passe em `USER_PASSWORD` ou gerada).
- API v1 em `/api/v1` (Bearer token; `JWT_SECRET` obrigatório em produção). A tarefa de cobranças corre no arranque e a cada 15 min (`BILLING_JOBS=off` desliga).
- `npm run import:legacy -- --dry-run` — gera em `backups/` um relatório da importação dos dados antigos (saldos por motorista, semanas em aberto, penalidades nunca cobradas, avisos) sem gravar nada. Sem `--dry-run` grava numa transação e recusa repetir. **Só importar no corte final**: depois disso, o PWA deixa de ser a fonte de verdade. As semanas importadas não recebem penalidades automáticas (`settings.penalties_from`).

### 6. Acesso e cópias de segurança

- A app pede a **chave de acesso** (`APP_ACCESS_KEY`) uma vez por aparelho; a sessão dura 30 dias (cookie `HttpOnly`). Ficheiros em `/uploads` também exigem sessão.
- Se dois aparelhos gravarem ao mesmo tempo, o servidor recusa a gravação desatualizada (409) e a app oferece descarregar uma cópia dos dados do aparelho antes de carregar a versão do servidor.
- `npm run db:backup` exporta o estado e os metadados dos uploads para `backups/` (para produção: `DATABASE_URL=<url pública do Postgres> PGSSL=true npm run db:backup`). Os ficheiros do Volume têm de ser copiados à parte.
- `app_state_audit` guarda no máximo uma cópia a cada 5 minutos e apaga cópias com mais de 90 dias.
