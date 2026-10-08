# UHOCHA Frota — Diagnóstico completo e plano da app mobile (Flutter)

> Data: 07-10-2026 · Base analisada: commit `59bf05b` (`app.js` 3 854 linhas, `backend/server.js` 202 linhas, `schema.sql`)

---

## 1. Resumo executivo

O sistema atual é um PWA de um único ficheiro (`app.js`) que guarda **todo o estado da empresa num único JSON** (`app_state.payload`), sincronizado por "último a gravar ganha", **sem autenticação**. Funciona para um utilizador num aparelho, mas tem:

- **1 bug que bloqueia a app** (`persistState` não existe — ver 2.2-B1).
- **Duas fontes de verdade** para "quem conduz que viatura" (`vehicle.driverId` vs `assignments`), que divergem facilmente.
- **Não existe o conceito de dívida/conta corrente**: uma semana não paga desaparece dos alertas na segunda seguinte. Este é o maior problema de negócio.
- **API pública**: qualquer pessoa com o URL pode ler, apagar ou substituir todos os dados e documentos (BI, cartas).
- Registos (entregas, despesas, ocorrências, documentos) **só podem ser apagados, nunca editados ou resolvidos**.

**Recomendação:** não portar o `app.js` tal como está para Flutter. Primeiro corrigir o modelo de dados e a API (backend normalizado + autenticação), depois construir a app Flutter sobre essa API, com modo offline. O PWA atual continua a funcionar durante a transição (com o bug B1 corrigido já).

---

## 2. Diagnóstico

### 2.1 Arquitetura atual

| Camada | Estado atual | Problema |
|---|---|---|
| Frontend | IIFE vanilla JS, HTML por template strings, `innerHTML` em cada render | Monolito de 3,8k linhas; re-render completo a cada clique; lógica de negócio misturada com UI |
| Estado | 1 objeto JS em `localStorage` + `PUT /api/state` com o objeto inteiro (debounce 450 ms) | Sem conflitos resolvidos, sem granularidade, payload cresce sem limite |
| Backend | Express: `GET/PUT /api/state`, `POST /api/uploads`, estáticos | Sem regras de negócio, sem validação, sem auth |
| BD | `app_state` (1 linha jsonb), `app_state_audit` (cópia integral a cada gravação), `uploads` | Auditoria guarda o estado inteiro a cada ~0,5 s de edição → crescimento rápido; impossível consultar/relatar em SQL |
| Ficheiros | Disco local / Volume Railway, servidos em `/uploads/*` sem controlo | Documentos pessoais públicos por URL |
| Dependências externas | CDN Hugeicons; imagens de carros por hotlink a `cdn.imagin.studio` com `customer=img` | Podem deixar de funcionar a qualquer momento |

### 2.2 Bugs confirmados no código

| # | Gravidade | Local | Descrição | Efeito |
|---|---|---|---|---|
| B1 | **Crítica** | `app.js:728` | `syncAutomaticEventStates()` chama `persistState()`, que não existe (a função é `persist`). | Assim que uma ocorrência muda de estado automaticamente (começa ou termina), `render()` lança `ReferenceError` e **a app fica em branco** em todas as páginas. |
| B2 | Alta | `app.js:3098-3104` | Ocorrência com "Imobilizar viatura" imobiliza **imediatamente**, mesmo com data de início futura. | Viatura sai das contas e da atribuição antes do tempo. |
| B3 | Alta | `app.js:476-492` | Ocorrência isentável **sem data de término** e não resolvida tem `end = Infinity`. Não existe botão para resolver ocorrências. | Motorista fica isento de pagar **para sempre**; só apagando o registo se corrige (e perde-se o histórico). |
| B4 | Alta | `app.js:516-535` | O "Esperado" semanal só desconta isenções vindas de ocorrências/estado da viatura; as **isenções registadas como entrega** (`isExempt`) contam como esperado mas com valor 0. | Meta semanal e % de progresso errados quando há isenções manuais. |
| B5 | Média | `app.js:706-716` vs `1226` | O sincronizador põe viaturas em estado `inativo`, que não existe no formulário (`ativo/manutencao/imobilizado/parado`). Editar a viatura troca silenciosamente o estado. | Estado inconsistente. |
| B6 | Média | `app.js:1910-1912` | O ecrã Contrato lista só ocorrências `aberto`; o sincronizador muda-as para `em_curso`/`agendado`. | Ocorrências em curso desaparecem das "abertas". |
| B7 | Média | `app.js:594` | Alerta de documento usa `vehicleName(...) \|\| driverName(...)`; `vehicleName` nunca é vazio ("Sem viatura"). | Documentos de motoristas aparecem como "Sem viatura". |
| B8 | Média | `app.js:1447` | "Penalidades devidas" no perfil soma penalidades calculadas sem subtrair `penaltyPaid`. | Dívida de penalidades sobrestimada. |
| B9 | Média | `app.js:2319-2321` vs `394-401` | Painel agrupa entregas por `paidAt`; relatório semanal e tendência mensal agrupam por `dueAt`. | Números diferentes para a "mesma" semana/mês. |
| B10 | Baixa | `app.js:3053-3072` | Despesa "Todas as viaturas" grava o valor introduzido em cada viatura (correto pela decisão 4), mas **nunca mostra o total** antes nem depois de gravar, e o rótulo "Valor" não diz que é por viatura. | Gestor pode introduzir o total pensando que será dividido. |
| B11 | Média | `app.js:3320-3339` | Apagar viatura/motorista apaga as atribuições (histórico) mas deixa entregas/despesas órfãs. | Relatórios com "Sem viatura/Sem motorista"; perda de histórico contratual. |
| B12 | Baixa | `app.js:644` e `753` | `pageHead` definida duas vezes. | Código morto. |
| B13 | Baixa | `app.js:566`, `2566` | Ícone `info` não está no mapa → aparece ícone de grelha. | Visual. |
| B14 | Baixa | `index.html:22` | Nome "Erasmo"/"ER" fixo no HTML. | Não há conceito de utilizador. |
| B15 | Baixa | `app.js:27-28` | `deliveryDay` e `maintenanceDayName` existem nas definições mas não são usados. | Configuração enganadora. |

### 2.3 Problemas de fluxo e regras de negócio

1. **Sem conta corrente do motorista (o mais grave).** O sistema só pergunta "pagou esta semana?". Semanas passadas não pagas, pagamentos parciais (com justificação) e penalidades por pagar não acumulam em lado nenhum. Na segunda seguinte, a pendência some. Não é possível responder "quanto me deve o motorista X?".
2. **Duas fontes de verdade para atribuição.** O formulário de viatura permite escolher "Motorista atribuído" diretamente (`vehicle.driverId`) sem criar `assignment`. O painel usa `vehicle.driverId`; o formulário de entrega usa `assignments`. Resultado: motorista aparece no painel como pendente mas não aparece no formulário de entrega (ou vice-versa).
3. **Semântica da semana ambígua.** `dueDateTime()` usa a segunda-feira da semana corrente. Um pagamento feito ao domingo é contado como pagamento **atrasado** da semana em curso, em vez de antecipado da semana seguinte. É preciso definir: a entrega de segunda paga a semana que terminou ou a que começa?
4. **Isenção registada em dois sítios** (ocorrência com "isentar" e entrega com "Isenção de semana"), com regras diferentes. Deve haver um só mecanismo.
5. **Ocorrências sem ciclo de vida.** Não se editam, não se resolvem, não se anexam fotos/participação policial; prazos do contrato (sinistro em 2h, furto em 4h) não são controlados.
6. **Devolução de viatura incompleta.** "Encerrar" não regista km, combustível, estado, danos, devolução de caução, nem acerto de contas final; viatura vai sempre para `parado`.
7. **Documentos dispersos.** Validade do BI/carta está no motorista, seguro/inspeção da viatura não têm validade, documentos avulsos estão noutra lista. Alertas só olham para a lista avulsa → BI e carta expirados **não geram alerta**.
8. **Multas contratuais não automáticas.** "Fora de horário" usa valor por omissão, mas >72h (resolução), multa diária por não restituição e franquia de sinistro não geram cobranças.
9. **Alertas não acionáveis.** Clicar em "Entrega pendente" leva ao separador Registar sem pré-selecionar o motorista.
10. **Sem edição** de entregas, despesas, ocorrências e documentos (só apagar).
11. **Sem utilizadores/perfis**, logo sem saber quem registou o quê.

### 2.4 Segurança e privacidade

- **S1 — Sem autenticação.** `GET/PUT /api/state` e `POST /api/uploads` estão abertos. Qualquer pessoa pode apagar a empresa inteira com um `PUT {}`-like válido.
- **S2 — Documentos pessoais públicos.** `/uploads/<uuid>.jpg` servido sem controlo (BI, carta, comprovativos). UUIDs também ficam no JSON público.
- **S3 — `cors({ origin: true })`** reflete qualquer origem.
- **S4 — Upload confia no `mimetype` do cliente**; extensão vem do nome original.
- **S5 — Sem rate limit / tamanho de auditoria controlado.**
- **S6 — Dados pessoais (GPS da residência, BI, contactos de familiares)** sem política de acesso; relevante para a Lei n.º 22/11 de Proteção de Dados (Angola).

### 2.5 Dados e sincronização

- Last-write-wins sobre o estado inteiro: dois aparelhos a editar ao mesmo tempo → um perde tudo o que fez.
- `loadRemoteState()` escolhe o estado com **mais registos**: um aparelho antigo com mais registos sobrepõe o servidor, e apagamentos feitos noutro aparelho "ressuscitam".
- Auditoria grava o JSON completo a cada gravação (crescimento O(n) por edição).
- Não há migrações de esquema do payload (`version: 1` fixo).

### 2.6 UX mobile atual

- Formulários longos em modal (motorista: ~25 campos num único ecrã).
- Tabelas largas em ecrãs pequenos (linha do tempo, relatórios).
- Navegação por hash, sem pilha de "voltar" real.
- Ações perigosas (apagar viatura) a um toque de distância na lista.
- Sem pesquisa/filtros nas listas.
- Sem notificações (o prazo de segunda 12:00 é o momento-chave do negócio).

---

## 3. Sistema redesenhado (modelo de domínio)

### 3.1 Princípio central: **Cobrança semanal + Conta corrente**

Em vez de "pagou esta semana?", o sistema gera, para cada atribuição ativa, uma **cobrança** (`charge`) por semana. Pagamentos **amortizam** cobranças. O saldo do motorista é `Σ cobranças − Σ pagamentos`.

```
Atribuição ativa ──(job semanal, segunda 00:00)──► Charge semanal (130 000 Kz, vence seg 12:00)
                                                     │
            Ocorrência isentável aprovada ──────────►│ status = isenta (valor 0, motivo, ligação à ocorrência)
                                                     │
            Pagamento (total/parcial) ──────────────►│ status = paga / parcial
                                                     │
            Job de atraso (seg 12:00 +24h, +72h) ───►│ gera Charge de penalidade (5 000 / 15 000)
                                                     │  >72h → alerta "resolução do contrato"
```

Tipos de `charge`: `semanal`, `penalidade_atraso`, `multa_fora_horario`, `multa_nao_restituicao`, `franquia_sinistro`, `multa_conduta`, `ajuste`. Assim **todas** as regras do contrato passam a ser cobranças auditáveis.

### 3.2 Entidades (tabelas Postgres)

| Tabela | Campos-chave | Notas |
|---|---|---|
| `users` | id, nome, telefone, email?, password_hash/pin_hash, role (`admin`, `gestor`, `motorista`), driver_id?, ativo, ultimo_acesso | `motorista` ligado a 1 `drivers` |
| `payment_declarations` | id, driver_id, valor, data, metodo, referencia, comprovativo_id, estado (`pendente`,`confirmada`,`rejeitada`), motivo_rejeicao, payment_id? | pagamento **declarado** pelo motorista; só vira `payment` quando o gestor confirma |
| `expense_batches` | id, descricao, categoria, valor_por_viatura, n_viaturas, total, modo (`por_viatura`/`dividir_total`) | decisão 4 |
| `vehicles` | id, marca, modelo, matricula (única), cor, ano, chassis, km_atual, estado, foto_id, deleted_at | estado **derivado** por regras (ver 3.3) |
| `drivers` | id, nome, telefone, bi, nif, categoria_carta, morada, lat/lng, caucao, user_id?, deleted_at | |
| `driver_contacts` | driver_id, nome, relacao, telefone | |
| `assignments` | id, vehicle_id, driver_id, inicio, fim, taxa_semanal, caucao_recebida, km_entrega, comb_entrega, checklist jsonb, km_devolucao, comb_devolucao, motivo_fim, estado | **única fonte de verdade** de quem conduz o quê; índice único parcial "1 ativa por viatura" e "1 ativa por motorista" |
| `charges` | id, assignment_id, driver_id, vehicle_id, tipo, periodo_inicio, periodo_fim, vence_em, valor, estado (`aberta`,`parcial`,`paga`,`isenta`,`anulada`), motivo_isencao, incident_id? | |
| `payments` | id, driver_id, valor, recebido_em, metodo (numerário/transferência/multicaixa), referencia, comprovativo_id, notas, registado_por | |
| `payment_allocations` | payment_id, charge_id, valor | permite pagamento em grupo, parcial e de semanas antigas |
| `expenses` | id, vehicle_id?, categoria, responsavel (`proprietaria`/`motorista`), valor, data, fornecedor, recibo_id, lote_id, notas | despesa em lote **divide** o valor (ou pergunta) |
| `incidents` | id, tipo, vehicle_id, driver_id, inicio, fim, estado (`agendada`,`em_curso`,`resolvida`,`cancelada`), isenta_cobranca, imobiliza, encerra_atribuicao, valor, prazo_comunicacao_cumprido, notas | ciclo de vida completo |
| `incident_attachments` | incident_id, file_id | fotos, participação policial |
| `documents` | id, owner_type (`vehicle`,`driver`,`company`), owner_id, tipo (enum), numero, emitido_em, valido_ate, file_id | BI, carta, livrete, seguro, inspeção… tudo aqui |
| `files` | id, nome, mime (verificado), tamanho, storage_key, criado_por | servidos só via URL assinado/autenticado |
| `settings` | chave/valor (taxa semanal, penalidades, hora limite, dia de entrega, fuso `Africa/Luanda`) | versão + histórico |
| `audit_log` | id, user_id, entidade, entidade_id, acao, diff jsonb, em | diff, não estado inteiro |
| `notifications` | id, user_id, tipo, payload, lida_em | |

Remoção: **soft delete** (`deleted_at`) para viaturas, motoristas e movimentos financeiros; financeiros só se **anulam** com motivo.

### 3.3 Máquinas de estado

**Viatura** (derivado, não editável à mão salvo `abatida`):
`disponivel` → (atribuição) → `em_servico` → (ocorrência que imobiliza começa) → `imobilizada` → (ocorrência resolvida) → `em_servico`/`disponivel` · `abatida` (terminal).

**Atribuição:** `ativa` → `encerrada` (devolução, com checklist e acerto de contas) | `substituida` | `rescindida`.

**Ocorrência:** `agendada` → `em_curso` → `resolvida` | `cancelada`. Transições automáticas pelo servidor (job a cada 15 min), nunca pelo cliente.

**Cobrança:** `aberta` → `parcial` → `paga` · `aberta` → `isenta` · qualquer → `anulada` (com motivo, só admin).

### 3.4 Regras de negócio decididas (07-10-2026)

| # | Questão | Decisão |
|---|---|---|
| 1 | O que paga a entrega de segunda? | **A semana que terminou** (segunda a domingo anteriores). Vence na segunda seguinte às `deliveryHour` (12:00). |
| 2 | Semana incompleta (início/fim de atribuição a meio) | **Proporcional aos dias trabalhados.** |
| 3 | Isenções | **Só por dias parados**; o cálculo é **sempre por dias**. Não há isenção de semana inteira "por decisão" — uma semana inteira parada é simplesmente 0 dias trabalhados. |
| 4 | Despesa para todas as viaturas | Calcula-se o **valor de cada viatura** e mostra-se/regista-se o **valor total** do lote. |
| 5 | Atraso > 72h | **Só gera alerta** (além da penalidade de 15 000 Kz); sem rescisão automática. |
| 6 | Motoristas | **Tipo de utilizador `motorista` na mesma app** (ver 5.7). |

#### Cálculo da cobrança semanal (decorre de 1–3)

```
semana        = segunda 00:00 → domingo 23:59 (fuso Africa/Luanda)
vence_em      = segunda seguinte, deliveryHour
dias_úteis    = dias da semana em que a viatura pode circular
taxa_diária   = taxa_semanal_da_atribuição / dias_úteis_da_semana_completa
dias_cobrados = dias_úteis ∩ [início atribuição, fim atribuição] − dias parados (ocorrências isentáveis)
valor         = round(taxa_diária × dias_cobrados)   (arredondar ao Kz; semana completa = taxa_semanal exata)
```

- A cobrança é gerada pelo servidor na segunda às 00:00 para a semana que terminou, e **recalculada** se uma ocorrência dessa semana for criada, editada ou resolvida depois (enquanto a cobrança não estiver paga; se já estiver paga, gera-se um `ajuste`/crédito).
- Uma ocorrência isentável conta como dia parado se cobrir a maior parte do dia útil (regra a afinar: proponho ≥ 4h dentro do horário de circulação desse dia).
- A cobrança guarda o detalhe (`dias_cobrados`, `dias_parados`, `taxa_diária`, ocorrências ligadas) para o motorista e o gestor verem **porquê** o valor é aquele.

> **Por confirmar (1 ponto):** o contrato diz que **segunda-feira não circula**. A taxa diária é `130 000 / 6` (terça a domingo = 21 667 Kz/dia) ou `130 000 / 7` (18 571 Kz/dia)? Proposta: **/6**, coerente com o contrato. Fica configurável nas Definições.

#### Despesa em lote (decisão 4)

O gestor introduz o **valor por viatura** e escolhe as viaturas (todas ou seleção); o ecrã mostra em tempo real `N viaturas × valor = total`. Grava-se um `expense_batch` (com o total) e uma linha de despesa por viatura (com o valor de cada uma), para que o lucro por viatura e o total da empresa fiquem certos. Opção alternativa no mesmo ecrã: "dividir um total" (introduz o total, o sistema divide e mostra o valor de cada viatura), para faturas únicas como seguro de frota.

---

## 4. Backend (pré-requisito da app Flutter)

### 4.1 Decisão de stack

Manter **Node.js + Express + Postgres no Railway** (já em produção, equipa conhece). Acrescentar:

- **TypeScript** + **Zod** (validação de pedidos e tipos partilhados por OpenAPI).
- **Kysely** ou **Drizzle** para queries tipadas + migrações versionadas (substituir o `schema.sql` idempotente).
- **JWT** (access 15 min + refresh 30 dias, rotação) com `argon2` para passwords.
- **pg-boss** (filas/cron em Postgres, sem infra extra) para: gerar cobranças semanais, penalidades, transição de ocorrências, alertas de validade, envio de push.
- **Firebase Cloud Messaging** para notificações push.
- Ficheiros: manter Volume Railway mas servidos por `GET /api/files/:id` autenticado (ou migrar para S3/R2 com URLs assinadas).
- **OpenAPI** gerado a partir dos schemas Zod → cliente Dart gerado automaticamente.

### 4.2 API REST (v1)

```
POST   /api/v1/auth/login | /refresh | /logout
GET    /api/v1/me

GET    /api/v1/dashboard?semana=2026-W41          (KPIs já calculados no servidor)
GET    /api/v1/alerts

CRUD   /api/v1/vehicles        GET /vehicles/:id/timeline
CRUD   /api/v1/drivers         GET /drivers/:id/statement   (conta corrente)
POST   /api/v1/assignments                     (atribuir)
POST   /api/v1/assignments/:id/close           (devolução + acerto)
GET    /api/v1/charges?driver=&estado=&semana=
POST   /api/v1/charges/:id/exempt | /void
POST   /api/v1/payments                         (com alocações; suporta grupo)
POST   /api/v1/payments/:id/void
CRUD   /api/v1/expenses
CRUD   /api/v1/incidents       POST /incidents/:id/resolve
CRUD   /api/v1/documents
POST   /api/v1/files            GET /api/v1/files/:id
GET    /api/v1/reports/summary?de=&ate=&agrupar=semana|mes|viatura|motorista
GET    /api/v1/reports/export.csv | .pdf
GET    /api/v1/sync/changes?since=<cursor>      (para offline)
GET/PUT /api/v1/settings
```

Toda a lógica de cálculo (esperado, atrasos, penalidades, isenções, lucro) passa para o servidor → web e mobile dão **os mesmos números**.

### 4.3 Migração dos dados atuais

Script `migrate-from-blob`: lê `app_state.payload` → cria viaturas, motoristas, contactos, atribuições (e cria atribuição sintética onde só existe `vehicle.driverId`), documentos (incluindo BI/carta/livrete dos `files` embutidos), despesas, ocorrências; converte `payments` em `payments` + `charges` reconstruídas semana a semana desde o início de cada atribuição. Gera relatório de discrepâncias para revisão manual. `app_state` fica só de leitura como cópia de segurança.

---

## 5. App Flutter

### 5.1 Stack

| Necessidade | Pacote |
|---|---|
| Estado / DI | `flutter_riverpod` + `riverpod_generator` |
| Navegação | `go_router` (ShellRoute com bottom nav, deep links de notificações) |
| HTTP | `dio` + interceptor de refresh token |
| Modelos | `freezed` + `json_serializable` (gerados do OpenAPI) |
| Offline / cache | `drift` (SQLite) — leitura offline + fila de escritas |
| Credenciais | `flutter_secure_storage` |
| Formulários | `reactive_forms` ou `flutter_form_builder` |
| Ficheiros / câmara | `image_picker`, `file_picker`, `flutter_image_compress` |
| GPS / mapas | `geolocator`, `url_launcher` (Google Maps) |
| Gráficos | `fl_chart` |
| Datas / moeda | `intl` (`pt_AO`, Kz, fuso `Africa/Luanda`) |
| PDF / partilha | `pdf`, `printing`, `share_plus` (recibos e relatórios por WhatsApp) |
| Push | `firebase_messaging`, `flutter_local_notifications` |
| Erros | `sentry_flutter` |
| Testes | `flutter_test`, `mocktail`, `integration_test`, golden tests |

Alvos: Android (prioridade — mercado angolano) e iOS. Mínimo Android 7 (API 24).

### 5.2 Estrutura do projeto (feature-first)

```
mobile/
  lib/
    main.dart
    app/            router.dart, theme/, l10n/, env.dart
    core/           api/ (dio, interceptors, cliente gerado), db/ (drift), sync/,
                    auth/, utils/ (money, dates, week), widgets/ (design system)
    features/
      auth/         login, sessão, PIN/biometria
      dashboard/
      cobrancas/    semana atual, receber pagamento, isentar, conta corrente
      frota/        viaturas/, motoristas/, atribuicoes/
      ocorrencias/
      despesas/
      documentos/
      relatorios/
      definicoes/   contrato/valores, utilizadores, tema
      alertas/
    each feature:   data/ (repository, dto) · domain/ (models) · presentation/ (screens, widgets, controllers)
  test/  integration_test/
```

### 5.3 Navegação e ecrãs

**Barra inferior (5):** Início · Cobranças · **(+)** · Frota · Mais

- **(+) ação rápida** (bottom sheet): Receber pagamento · Nova despesa · Nova ocorrência · Novo documento · Atribuir viatura.
- **Mais:** Relatórios, Ocorrências, Despesas, Documentos, Contrato/Valores, Utilizadores, Tema, Exportar, Sair.

| Ecrã | Conteúdo principal |
|---|---|
| Login | telefone/email + password; depois PIN/biometria |
| Início | Cartão "Semana 41": esperado / recebido / em falta + barra; contagem decrescente até seg 12:00; **Pendentes** (lista acionável → receber); dívida total em aberto; alertas por gravidade; lucro do mês |
| Cobranças | Seletor de semana; lista por motorista com estado (pago/parcial/isento/atrasado); ação deslizante "Receber" e "Isentar"; filtro "só em dívida" |
| Receber pagamento | Motorista (ou vários) → mostra cobranças abertas (mais antigas primeiro) → valor → alocação automática editável → método, referência, foto do comprovativo → recibo PDF partilhável |
| Conta corrente do motorista | Saldo, extrato (cobranças/pagamentos), semanas em atraso, penalidades |
| Frota → Viaturas | Lista com pesquisa, chip de estado, motorista; detalhe com separadores Resumo / Movimentos / Documentos / Ocorrências |
| Frota → Motoristas | Lista com saldo em dívida; perfil com Resumo / Conta corrente / Documentos / Histórico; ligar/WhatsApp com um toque |
| Atribuir viatura | Assistente 3 passos: viatura+motorista → condições (taxa, caução) → checklist de entrega (km, combustível, fotos 4 lados, documentos, chaves, GPS) |
| Devolver viatura | Assistente: km, combustível, fotos, danos → acerto (saldo em dívida, caução a devolver/reter) → encerrar |
| Ocorrência | Tipo → viatura/motorista (auto) → período → impacto (isentar, imobilizar, encerrar atribuição) com pré-visualização ("isenta 2 semanas, 260 000 Kz") → fotos → guardar; ações Resolver/Editar/Cancelar |
| Despesa | Valor, categoria, responsável, viatura(s), recibo (foto); lote com divisão explícita |
| Documentos | Lista por validade (expirados primeiro); captura por câmara |
| Relatórios | Período; KPIs; gráfico de barras semanal esperado vs recebido; ranking motoristas/viaturas; exportar PDF/CSV |
| Definições | Valores do contrato (com histórico e "aplica-se a partir de"), utilizadores e perfis |

Formulários longos (motorista, viatura) passam a **assistentes por passos** com gravação de rascunho.

### 5.4 Design system

- Material 3 com `ColorScheme.fromSeed` a partir da cor da marca (`#c9f158`), modo claro/escuro.
- Tokens: espaçamentos 4/8/12/16/24, raios 12/20, tipografia Inter ou a fonte atual.
- Componentes partilhados: `MoneyText`, `StatusChip`, `KpiCard`, `RecordTile`, `EmptyState`, `SectionHeader`, `AsyncValueView` (loading/erro/vazio), `ConfirmSheet`, `PhotoPickerField`, `EntityPicker` (pesquisa de motorista/viatura).
- Ícones: `hugeicons` (pacote Flutter) para manter identidade visual, ou `lucide_icons`.
- Acessibilidade: alvos ≥48 dp, contraste AA, textos escaláveis.

### 5.5 Offline e sincronização

- Leitura: cache em Drift de viaturas, motoristas, cobranças da semana, documentos → app abre e mostra dados sem rede.
- Escrita: operações (não estado) entram numa **fila de saída** com `client_id` (UUID) idempotente; o servidor ignora duplicados. Ficheiros sobem antes da operação que os referencia.
- Pull incremental `GET /sync/changes?since=cursor`.
- Conflitos: o servidor é a autoridade; operações financeiras nunca se sobrepõem (são acrescentadas); edições de cadastro usam `updated_at` (rejeita 409 → app mostra diferença).
- Indicador visível: "3 alterações por enviar".

### 5.6 Notificações

- Domingo 18:00: "Amanhã é dia de entrega — 7 viaturas esperadas".
- Segunda 12:00: resumo de pendentes.
- +24h / +72h: penalidades aplicadas; >72h alerta de resolução.
- 30/7/0 dias antes da validade de documentos.
- Início/fim de ocorrências com imobilização.
- Motorista: lembrete da entrega, cobrança gerada (com valor e dias), comprovativo confirmado/rejeitado, penalidade aplicada, documento a expirar.

### 5.7 Perfil `motorista` na mesma app (decisão 6)

Uma só app nas lojas; após o login, o router escolhe o **shell** pelo `role`.

**Acesso e conta**
- O gestor cria o motorista e carrega em "Convidar para a app" → gera código de ativação de 6 dígitos (válido 48h), partilhado por WhatsApp/SMS pelo gestor.
- O motorista entra com telefone + código, define um **PIN de 6 dígitos**; depois biometria opcional. "Esqueci o PIN" → gestor gera novo código (evita custos de SMS/OTP).
- Gestor pode suspender o acesso; ao encerrar a atribuição o acesso mantém-se só para ver o extrato.

**Segurança (servidor)**
- Todas as rotas filtram por `driver_id` do token quando `role = motorista` (o motorista **nunca** recebe dados de outros motoristas, nem lucros, despesas da proprietária ou definições).
- Rotas próprias: `GET /api/v1/me/statement`, `/me/charges`, `/me/vehicle`, `/me/documents`, `POST /me/payment-declarations`, `POST /me/incidents`.
- Ficheiros: o motorista só acede aos ficheiros que lhe pertencem.

**Barra inferior do motorista (4):** Início · Pagamentos · **(+)** · Perfil

| Ecrã | Conteúdo |
|---|---|
| Início | Saldo em dívida (destaque), próxima entrega (valor + contagem até segunda 12:00), viatura atribuída, avisos (penalidades, documentos a expirar) |
| Pagamentos | Extrato: cobranças semanais com detalhe "6 dias × 21 667 Kz − 2 dias parados (oficina)", pagamentos, penalidades, estado dos comprovativos |
| (+) Ação rápida | **Enviar comprovativo** (foto/PDF + valor + referência) · **Comunicar ocorrência** (sinistro, avaria, furto, doença) com hora registada automaticamente, fotos e GPS |
| Perfil | Dados pessoais (só leitura, pedido de alteração ao gestor), documentos e validades, viatura e checklist de entrega, regras do contrato, mudar PIN, sair |

**Fluxos do motorista**
- *Pagamento:* motorista envia comprovativo → fica `pendente` → gestor recebe notificação e confirma (cria `payment` e aloca às cobranças mais antigas) ou rejeita com motivo → motorista é notificado. **Para efeitos de atraso conta a data/hora do envio do comprovativo** se for confirmado (cumpre "comprovativo em até 12 horas" do contrato).
- *Ocorrência:* motorista comunica → fica `por_validar`; gestor valida e define impacto (dias parados, imobilização). Isenção só é aplicada após validação. A hora de comunicação fica registada, permitindo verificar os prazos de 2h (sinistro) e 4h (furto).

**Do lado do gestor** aparece uma caixa **"Para validar"** no Início: comprovativos e ocorrências enviados por motoristas.

---

## 6. Fluxos redesenhados (antes → depois)

| Fluxo | Hoje | Novo |
|---|---|---|
| Valor da semana | Sempre 130 000 Kz (ou 0 se isento) | Calculado por dias trabalhados, com detalhe visível ao gestor e ao motorista |
| Comprovativo | Só o gestor regista | Motorista envia pela app; gestor confirma com um toque |
| Registar entrega | Escolher motorista; se não pagar, nada fica registado; semanas passadas perdem-se | Ecrã Cobranças mostra quem deve o quê (incluindo semanas antigas); receber aloca às cobranças mais antigas; recibo partilhável |
| Pagamento parcial | Valor diferente + justificação, mas a diferença desaparece | Cobrança fica `parcial` e o resto continua em dívida |
| Isenção | Dois mecanismos, um deles infinito | Só via ocorrência (ou "Isentar" na cobrança, que cria ocorrência); sempre com período; pré-visualização do impacto |
| Atribuição | Pode-se "atribuir" pelo formulário da viatura sem registo | Só pelo assistente; campo removido do formulário da viatura |
| Devolução | Botão "Encerrar" | Assistente com checklist e acerto de contas/caução |
| Documentos | Três sítios, BI/carta sem alertas | Uma entidade `documents`, alertas para todos |
| Alertas | Navegam para separador genérico | Abrem a ação certa já preenchida |
| Correções | Só apagar | Editar cadastro; anular movimentos financeiros com motivo (auditado) |

---

## 7. Plano de implementação por fases

Estimativas para 1 programador full-stack a tempo inteiro. Cada fase termina com algo utilizável.

### Fase 0 — Estabilizar o que existe ✅ concluída (07-10-2026, ramo `fase-0-estabilizar`)
- [x] B1 `persistState` → `persist` (app deixava de abrir).
- [x] B2 imobilização só no início real da ocorrência (aplicada automaticamente quando a data chega).
- [x] B3 ação **Resolver** em ocorrências; alerta para ocorrências isentáveis abertas sem fim há mais de 7 dias.
- [x] B4 isenções manuais descontadas do esperado semanal.
- [x] B5 estado `inativo` eliminado (migrado para `imobilizado`); ao libertar volta a `ativo`/`parado`.
- [x] B6 Contrato mostra todas as ocorrências não resolvidas (agendadas e abertas).
- [x] B7 alerta de documento mostra o dono certo; **BI e carta** dos motoristas passam a gerar alertas.
- [x] B8 "Penalidades em dívida" = devidas − pagas.
- [x] B10 despesa em lote: "Valor por viatura" + total visível antes e depois de gravar.
- [x] B11 remover viatura/motorista já não apaga o histórico de atribuições.
- [x] B12, B13 código duplicado e ícone `info`.
- [x] Fonte única de atribuição: formulário da viatura deixa de definir o motorista; dados antigos com motorista sem atribuição recebem uma atribuição automática.
- [x] Alertas ordenados por gravidade e sem limite de 12.
- [x] API protegida por chave de acesso (`APP_ACCESS_KEY`) com sessão em cookie `HttpOnly` (30 dias), limite de 10 tentativas/15 min, `/uploads` protegido; ecrã de entrada e botão Sair.
- [x] CORS só para `CORS_ORIGINS` explícitas.
- [x] Uploads: extensão pelo tipo, validação pelos primeiros bytes do ficheiro (415 se não corresponder).
- [x] Concorrência: `revision` no servidor, gravações desatualizadas recusadas (409); a app oferece descarregar cópia local e carrega a versão do servidor. Alterações pendentes sobrevivem a recarregar a página; reenvio quando volta a rede.
- [x] Auditoria: máx. 1 cópia/5 min, retenção 90 dias.
- [x] `npm run db:backup`.
- [ ] **Antes do deploy:** definir `APP_ACCESS_KEY` no Railway e correr `db:backup` contra produção.
- Fora da Fase 0 (fica para a Fase 2): utilizadores/perfis (nome "Erasmo" fixo — B14), B9 (critério de datas dos relatórios, resolvido pelo motor de cobranças), B15.

### Fase 1 — Decisões e desenho (2–3 dias)
- [x] Regras da secção 3.4 decididas.
- [ ] Confirmar divisor da taxa diária (6 ou 7) e regra de "dia parado".
- [ ] Wireframes dos ecrãs principais (Figma) — Início, Cobranças, Receber, Perfil do motorista, Atribuir/Devolver, Ocorrência + os 4 ecrãs do perfil motorista.
- [ ] Contrato OpenAPI v1 revisto.
- **Aceitação:** regras escritas e aprovadas; protótipo navegável aprovado.

### Fase 2 — Backend v1 (2,5–3 semanas) — ✅ API pronta para a app (ramo `fase-2-backend`)

Decisões de implementação tomadas:
- TypeScript executado nativamente pelo Node (≥ 22.18, sem passo de build) + `tsc --noEmit` para tipos.
- SQL direto com `pg` e migrações versionadas em `backend/migrations/` (em vez de Drizzle/Kysely: menos dependências; reavaliar se as queries crescerem).
- Taxa diária = taxa semanal / 6 (terça a domingo) por omissão, configurável em `contract_rules`.
- Dia parado = ≥ 4h de paragem dentro do horário de circulação desse dia. Dia de início conta; dia de devolução não conta.

Feito:
- [x] Motor de cobranças puro (`backend/domain/charges.ts`) + 30 testes.
- [x] Esquema normalizado (`002_dominio.sql`) e executor de migrações com bloqueio.
- [x] Importador do estado antigo + relatório de discrepâncias (`npm run import:legacy -- --dry-run`) + 7 testes. Semanas importadas não recebem penalidades automáticas (marco `penalties_from`).
- [x] Utilizadores admin/gestor/motorista: scrypt, JWT HS256 de 15 min + refresh token de 30 dias com rotação e deteção de reutilização, bloqueio após 5 falhas, convite do motorista por código de 6 dígitos (48h) + PIN.
- [x] Serviços de cobrança na base: geração idempotente das semanas, penalidades 24h/72h (só sobem), pagamentos com alocação às semanas mais antigas, crédito aplicado a cobranças futuras, idempotência por `clientId`, extrato do motorista.
- [x] API v1 (`/api/v1`): auth (login, refresh, logout, activate), `me`, `me/statement`, `users`, `drivers`, `drivers/:id/statement`, `drivers/:id/invite`, `charges`, `payments`, `admin/jobs/billing`. Tarefa de cobranças a cada 15 min com advisory lock. 11 testes de integração.

- [x] Cadastro: viaturas (estado derivado; abater), motoristas com contactos, documentos com validade; remoção lógica.
- [x] Ficheiros autenticados (`/files`): conteúdo verificado; motorista só abre o que é seu.
- [x] Atribuir e devolver: uma ativa por viatura/motorista, checklist de entrega/devolução, última semana cobrada na devolução, acerto com caução.
- [x] Ocorrências: gestor (validada logo) e motorista (por validar), validar/editar/resolver/cancelar com recálculo das cobranças (excesso pago volta a crédito), imobilização e encerramento de atribuição, multas e franquia limitada.
- [x] Pagamentos individuais e em grupo, anulação (admin), comprovativos do motorista (prazo conta a hora do pagamento se o comprovativo chegar até 12h depois).
- [x] Despesas: única, por viatura (total = valor × N) e dividir total (sem perder kwanzas).
- [x] Painel, alertas (> 72h, entregas pendentes, documentos, por validar) e ecrã inicial do motorista com estimativa da semana.
- [x] `GET /sync/changes` para a cache offline; auditoria de todas as operações.
- [x] Referência da API em `docs/API-v1.md`. 42 testes unitários + 27 de integração.

A fazer (antes do corte):
- [ ] Simulação da importação com uma cópia real de produção e revisão do relatório com o negócio.
- [ ] Notificações push (FCM) — fica para a Fase 6.
- [ ] Relatórios por período/motorista/viatura e exportação PDF/CSV — Fase 6.
- **Aceitação:** migração de uma cópia de produção reproduz os totais históricos (com discrepâncias explicadas); cobertura ≥80% no motor de cobranças.

### Fase 3 — Fundações Flutter ✅ (ramo `fase-3-flutter`)
- [x] `mobile/` (org `ao.uhocha`), Android + iOS (mínimo iOS 15), nome "UHOCHA Frota", logótipo.
- [x] Tema Material 3 com as cores UHOCHA (claro/escuro), `pt_PT`, kwanzas e datas na hora de Luanda.
- [x] Cliente da API com renovação automática e única do token; erros traduzidos com campos.
- [x] Sessão: entrar (equipa com palavra-passe, motorista com PIN), ativação do motorista por código, bloqueio biométrico opcional, restauro da sessão e modo sem ligação.
- [x] Navegação por perfil com botão central de ação rápida; redirecionamento por estado da sessão.
- [x] Cache "rede primeiro, cópia guardada sem ligação" com aviso visível.
- [x] Ecrãs já ligados à API: Início da equipa (semana a cobrar, dívida, líquido do mês, viaturas, alertas), Cobranças da semana, Frota (viaturas e motoristas com pesquisa), Alertas, Mais; Início do motorista (saldo, próxima entrega estimada, viatura, documentos, comprovativos), Pagamentos (detalhe por dias), Perfil.
- [x] 9 testes unitários/widgets + teste de integração no simulador iOS contra o backend (`npm run seed:demo`).
- Decisões: modelos escritos à mão (sem freezed/codegen) e cache em ficheiros JSON; a base local `drift` fica para a fila offline da Fase 6.
- Pendente do lado do ambiente: Android *cmdline-tools* + licenças; CI (GitHub Actions) para `flutter analyze/test`.

### Fase 4 — Núcleo operacional ✅ (ramo `fase-4-cobranca`)
- [x] Receber pagamento (motorista que deve primeiro, valor sugerido, pré-visualização das semanas pagas e do crédito, foto do comprovativo) e entrega em grupo.
- [x] Para validar: comprovativos (ver foto, confirmar/ajustar valor, rejeitar com motivo) e ocorrências comunicadas (validar com dias parados/imobilização, recusar).
- [x] Ficha do motorista: ligar/WhatsApp, convite para a app (código partilhável por WhatsApp), conta corrente com o cálculo por dias.
- [x] Motorista: enviar comprovativo com foto.
- [x] Registar/editar viaturas e motoristas (3 passos, contactos de emergência, caução).
- [x] Ficha da viatura (estado, motorista, documentos, despesas, ocorrências, histórico).
- [x] Atribuir viatura (3 passos: viatura+motorista livres, condições com taxa diária, checklist de entrega com combustível e fotos) e devolver (checklist, danos, fotos, uso da caução e acerto).
- [x] Testes de integração no simulador: `app_flow_test`, `cobranca_test`, `frota_test` (com capturas de cada passo).
- Corrigido pelo caminho: servidor caía quando o Postgres terminava ligações; app podia ficar presa no arranque; vários erros de interface só visíveis a correr a app.
- Recibo em PDF partilhável fica para a Fase 6 (relatórios/exportação).

### Fase 5 — Operações complementares (1,5 semanas)
- [ ] Ocorrências (criar, pré-visualizar impacto, resolver, anexos).
- [ ] Despesas (incl. lote com divisão).
- [ ] Documentos com validade e captura.
- [ ] Definições do contrato com histórico; gestão de utilizadores.

### Fase 5B — Perfil motorista (1,5 semanas)
- [ ] Shell e router por `role`; ativação por código + PIN.
- [ ] Início, Pagamentos (extrato com detalhe por dias), Perfil, documentos.
- [ ] Enviar comprovativo e comunicar ocorrência (câmara, GPS, hora).
- [ ] Caixa "Para validar" do gestor (confirmar/rejeitar).
- **Aceitação:** motorista envia comprovativo, gestor confirma, saldo do motorista atualiza nos dois telemóveis; motorista não consegue aceder a nenhum dado de outro motorista (teste automatizado).

### Fase 6 — Offline, notificações e relatórios (1,5 semanas)
- [ ] Fila de escrita offline idempotente + indicador de sincronização.
- [ ] FCM + notificações agendadas pelo servidor.
- [ ] Relatórios com gráficos e exportação PDF/CSV.

### Fase 7 — Qualidade e lançamento (1–1,5 semanas)
- [ ] Testes de widget/golden dos ecrãs-chave; `integration_test` do fluxo de cobrança.
- [ ] Sentry, analytics mínimos.
- [ ] Beta fechado (Play Console internal testing / TestFlight) com 1–2 gestores durante 2 semanas de cobranças reais em paralelo com o PWA.
- [ ] Migração final de produção, PWA passa a só leitura (ou é reconstruído sobre a API v1 — fora deste plano).
- [ ] Publicação na Play Store (e App Store se aplicável).

**Total estimado:** ~13–15 semanas para 1 pessoa (≈8–9 com 2 pessoas: uma backend, uma Flutter, a partir da Fase 2). Inclui o perfil motorista.

---

## 8. Riscos

| Risco | Mitigação |
|---|---|
| Regras da semana mal definidas geram dívidas erradas | Fase 1 bloqueante; testes do motor com casos reais |
| Migração do blob com dados inconsistentes | Relatório de discrepâncias + revisão manual antes do corte |
| Rede móvel instável | Offline-first em leitura, fila idempotente em escrita, compressão de imagens |
| Volume Railway único ponto de falha para ficheiros | Backups diários do volume ou migrar para R2/S3 |
| Adoção pelos gestores | Beta em paralelo; foco no fluxo de segunda-feira |

---

## 9. Próximos passos imediatos

1. ~~Corrigir B1~~ — Fase 0 concluída; falta definir `APP_ACCESS_KEY` no Railway e publicar.
2. Confirmar divisor da taxa diária (proposta: 6 dias, terça a domingo).
3. Decidir: 1 ou 2 programadores; Android só ou Android + iOS no lançamento.
4. Iniciar Fase 0 e Fase 1 em paralelo.
