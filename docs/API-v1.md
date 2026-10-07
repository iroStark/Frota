# API v1 — referência para a app Flutter

Base: `/api/v1`. JSON em UTF-8. Valores monetários em **kwanzas inteiros**. Datas: instantes em ISO 8601 com fuso (`2026-10-05T12:00:00+01:00`), dias em `YYYY-MM-DD` (hora de Luanda).

## Autenticação

| Método | Rota | Corpo | Notas |
|---|---|---|---|
| POST | `/auth/login` | `{ login, password }` | `login` = email ou telefone. Motoristas usam o PIN como `password`. 5 falhas → bloqueio de 15 min (429). |
| POST | `/auth/activate` | `{ phone, code, pin }` | Motorista: código de 6 dígitos dado pelo gestor (48h) + PIN de 6 dígitos. |
| POST | `/auth/refresh` | `{ refreshToken }` | Devolve **novo** par de tokens; o anterior deixa de valer. Reutilizar um token antigo termina todas as sessões. |
| POST | `/auth/logout` | `{ refreshToken }` | |

Resposta de sessão: `{ accessToken, accessTokenExpiresIn (s), refreshToken, user: { id, name, role, driverId } }`.
Pedidos autenticados: `Authorization: Bearer <accessToken>` (15 min). Renovar com `/auth/refresh` ao receber 401.

## Erros

`{ error: "mensagem para o utilizador", code: "codigo_estavel", details? }`

| Estado | Quando |
|---|---|
| 401 | sem sessão / sessão expirada |
| 403 | perfil sem permissão (`sem_permissao`) |
| 404 | não encontrado |
| 409 | conflito de regra (`viatura_atribuida`, `motorista_ocupado`, `ja_revisto`, `duplicado`…) |
| 413 / 415 | ficheiro grande / formato inválido |
| 422 | validação (`details.fieldErrors` por campo) |

## Idempotência (modo offline)

`POST /payments`, `/payments/batch` (por item), `/expenses` e `/me/payment-declarations` aceitam `clientId` (UUID gerado na app). Repetir com o mesmo `clientId` devolve o registo original (`replayed: true`, estado 200) em vez de duplicar.

## Rotas por perfil

Legenda: **E** = equipa (admin/gestor), **A** = só admin, **M** = motorista (só os seus dados), **T** = todos.

### Conta
| | Rota | Perfil |
|---|---|---|
| GET | `/me` | T |
| GET/POST | `/users` · PATCH `/users/:id` `{ active }` | A |
| POST | `/drivers/:id/invite` → `{ code, expiresInHours, phone }` | E |

### Painel
| | Rota | Perfil |
|---|---|---|
| GET | `/dashboard` — semana a cobrar (esperado/pago/em falta por motorista), dívida total, por validar, viaturas por estado, mês (recebido, despesas, líquido), `alerts[]` | E |
| GET | `/alerts` — `[{ severity: danger|warn|info, kind, title, detail, target? }]` | E |
| GET | `/me/home` — saldo, em atraso, próxima entrega estimada (dias cobrados/parados), viatura, documentos, últimos comprovativos, ocorrências abertas | M |

### Frota
| | Rota | Perfil |
|---|---|---|
| GET | `/vehicles?status&search` · GET `/vehicles/:id` (atribuições, documentos, ocorrências, totais de despesas) | E |
| POST | `/vehicles` `{ brand, model, plate?, color?, year?, chassis?, mileage?, photoFileId? }` | E |
| PATCH | `/vehicles/:id` (mesmos campos + `retired: true` para abater) · DELETE | E |
| GET | `/drivers?search` (com `balance`, `overdue`, `has_app_access`) | E |
| GET | `/drivers/:id` · `/drivers/:id/statement` | E, M (o próprio) |
| POST/PATCH | `/drivers` `{ name, phone?, bi?, nif?, licenseNumber?, licenseCategory?, address?, latitude?, longitude?, deposit?, contractStart?, photoFileId?, contacts?: [{ name, relation?, phone? }] }` · DELETE | E |
| GET | `/documents?ownerType&ownerId&expiringWithinDays` (cada um com `validity`: valido / a_expirar / expirado / sem_validade) | E |
| POST/PATCH/DELETE | `/documents` `{ ownerType, ownerId?, type, number?, issuedOn?, validUntil?, fileId?, notes? }` | E |

### Ficheiros
| | Rota | Perfil |
|---|---|---|
| POST | `/files` (multipart: `file`, `category?`) → `{ id, … }`. PDF/JPG/PNG/WEBP/HEIC, máx. 12 MB, conteúdo verificado. | T |
| GET | `/files/:id` | E; M só ficheiros seus ou ligados a si |

### Atribuições
| | Rota | Perfil |
|---|---|---|
| GET | `/assignments?status&vehicleId&driverId` | E |
| POST | `/assignments` `{ vehicleId, driverId, startAt, weeklyFee?, depositReceived?, handover?: { mileage, fuelLevel, checklist, photoFileIds, damages }, notes? }` | E |
| POST | `/assignments/:id/return` `{ endAt, reason?, returnInfo?, applyDeposit? }` → `{ assignment, settlement: { deposit, depositApplied, depositToReturn, balance, remainingDebt, credit } }` | E |

### Ocorrências
| | Rota | Perfil |
|---|---|---|
| GET | `/incidents?status&vehicleId&driverId` | E |
| GET | `/incidents/:id` · `/me/incidents` | E, M |
| POST | `/incidents` `{ type, vehicleId?, driverId?, startAt, endAt?, exemptsFee?, immobilizes?, releasesAssignment?, amount?, latitude?, longitude?, notes?, attachmentIds? }` | E (validada logo) · M (fica `por_validar`, ligada a si e à sua viatura) |
| POST | `/incidents/:id/validate` · PATCH `/incidents/:id` · POST `/incidents/:id/resolve` `{ endAt? }` · POST `/incidents/:id/cancel` `{ reason }` | E |

Tipos: `doenca, licenca, manutencao, paragem_tecnica, sinistro, avaria` (isentam por defeito), `multa, fora_horario, vistoria, gps, furto, outro`. Validar/editar/cancelar recalcula as cobranças afetadas; `fora_horario` sem valor usa a multa do contrato; `sinistro` com valor fica limitado à franquia máxima.

### Dinheiro
| | Rota | Perfil |
|---|---|---|
| GET | `/charges?driverId&status&periodStart&overdue=true` (com `paid`, `outstanding`, `calculation`) | E |
| POST | `/charges/:id/void` `{ reason }` | A |
| GET/POST | `/payments` `{ driverId, amount, receivedAt, method, reference?, notes?, proofFileId?, clientId? }` → `{ payment, allocations, credit }` | E |
| POST | `/payments/batch` `{ receivedAt, method, reference?, proofFileId?, items: [{ driverId, amount, clientId? }] }` | E |
| POST | `/payments/:id/void` `{ reason }` | A |
| GET/POST | `/me/payment-declarations` `{ amount, paidAt, method?, reference?, proofFileId, clientId? }` | M |
| GET | `/payment-declarations?status=pendente` · POST `/:id/confirm` `{ amount? }` · POST `/:id/reject` `{ reason }` | E |
| GET | `/me/statement` | M |
| GET/POST | `/expenses` `{ mode: unica|por_viatura|dividir_total, vehicleIds | allActiveVehicles, amount, category, responsible, spentOn, supplier?, receiptFileId?, notes?, clientId? }` · DELETE `/expenses/:id` | E |

`calculation` de uma cobrança semanal: `{ weeklyFee, workingDays, coveredDays[], stoppedDays[], chargedDays, dailyRate, incidentIds[] }` — usar para mostrar "4 dias × 21 667 Kz (2 dias parados: oficina)".

### Sincronização
`GET /sync/changes?since=<cursor>` → `{ cursor, changes: { vehicles, drivers, assignments, incidents, documents, charges, payments, payment_declarations, expenses? } }`. Sem `since` = tudo. Guardar o `cursor` e enviá-lo no pedido seguinte; as linhas vêm completas, substituir por `id` (podem repetir-se). Motoristas recebem só o que é seu.

### Administração
`POST /admin/jobs/billing` (A) — corre já a tarefa que o servidor executa a cada 15 min: avança ocorrências, gera cobranças semanais em falta e penalidades.
