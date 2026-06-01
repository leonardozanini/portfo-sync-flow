
# Consolidador de Carteira Multi-Moeda — Arquitetura do MVP

## 1. Stack Tecnológica Recomendada

**Frontend**
- TanStack Start (React 19 + Vite 7) — já é o stack do projeto (SSR + server functions)
- Tailwind CSS v4 + shadcn/ui — componentes acessíveis e tema customizável
- TanStack Query — cache de cotações e dados de carteira
- Recharts — gráficos (linha de patrimônio, rosca de alocação, barras de aportes)
- Motion (Framer Motion) — micro-interações no dashboard

**Backend / Dados (Lovable Cloud / Supabase)**
- PostgreSQL (Supabase) — schema relacional, RLS por usuário
- Supabase Auth — email/senha + Google
- Server Functions (TanStack `createServerFn`) — lógica de carteira, conversão FX, snapshots
- Server Routes em `/api/public/*` — webhooks de cron para sincronização de preços
- pg_cron (Supabase) — agendamento horário/diário do motor de preços

**Integrações de Mercado**
- Yahoo Finance (primária) via `yahoo-finance2` ou endpoint público
- Google Finance / Brapi.dev (fallback para B3)
- CoinGecko (cripto)
- exchangerate.host ou Open Exchange Rates (Forex diário)

**RBAC**
- Tabela `user_roles` + enum `app_role` (`admin`, `premium`, `free`)
- Função `has_role(uuid, app_role)` SECURITY DEFINER
- Gates em rotas (`_authenticated`, `_admin`) e em server functions

---

## 2. Esquema Inicial do Banco de Dados (SQL)

```sql
-- Enums
create type public.app_role as enum ('admin', 'premium', 'free');
create type public.asset_class as enum
  ('stock','reit','etf','crypto','fixed_income','fund','cash','other');
create type public.tx_type as enum ('buy','sell','dividend','deposit','withdraw');
create type public.currency_code as enum ('BRL','USD','EUR','GBP','JPY');

-- Perfis (1:1 auth.users)
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  base_currency currency_code not null default 'BRL',
  created_at timestamptz default now()
);

-- RBAC
create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role app_role not null,
  unique (user_id, role)
);

-- Catálogo global de ativos
create table public.assets (
  id uuid primary key default gen_random_uuid(),
  symbol text not null,                  -- AAPL, PETR4.SA, BTC
  name text,
  asset_class asset_class not null,
  currency currency_code not null,       -- moeda de cotação
  data_source text,                      -- 'yahoo','google','coingecko','manual'
  external_id text,
  unique (symbol, currency)
);

-- Lançamentos (transações)
create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  asset_id uuid not null references public.assets(id),
  tx_type tx_type not null,
  quantity numeric(20,8) not null,
  unit_price numeric(20,8) not null,     -- na moeda do ativo
  fees numeric(20,8) default 0,
  currency currency_code not null,       -- moeda do lançamento
  occurred_at date not null,
  notes text,
  created_at timestamptz default now()
);
create index on public.transactions (user_id, occurred_at desc);
create index on public.transactions (asset_id);

-- Preços históricos / atuais
create table public.asset_prices (
  asset_id uuid not null references public.assets(id) on delete cascade,
  price_date date not null,
  close_price numeric(20,8) not null,
  source text,
  primary key (asset_id, price_date)
);

-- Taxas de câmbio diárias
create table public.fx_rates (
  rate_date date not null,
  base currency_code not null,
  quote currency_code not null,
  rate numeric(20,8) not null,
  primary key (rate_date, base, quote)
);

-- Snapshots diários de patrimônio (para gráfico de evolução)
create table public.portfolio_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  snapshot_date date not null,
  base_currency currency_code not null,
  total_value numeric(20,2) not null,
  total_invested numeric(20,2) not null,
  pnl numeric(20,2) not null,
  unique (user_id, snapshot_date, base_currency)
);

-- Alertas para o Admin (ativos sem fonte)
create table public.price_fetch_failures (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid references public.assets(id),
  symbol text,
  reason text,
  resolved boolean default false,
  created_at timestamptz default now()
);

-- Função RBAC
create or replace function public.has_role(_user_id uuid, _role app_role)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.user_roles where user_id=_user_id and role=_role)
$$;

-- GRANTs (obrigatórios no schema public)
grant select, insert, update, delete on
  public.profiles, public.transactions, public.portfolio_snapshots to authenticated;
grant select on public.assets, public.asset_prices, public.fx_rates to authenticated;
grant select on public.user_roles to authenticated;
grant all on all tables in schema public to service_role;

-- RLS
alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;
alter table public.transactions enable row level security;
alter table public.portfolio_snapshots enable row level security;
alter table public.assets enable row level security;
alter table public.asset_prices enable row level security;
alter table public.fx_rates enable row level security;
alter table public.price_fetch_failures enable row level security;

-- Políticas (resumo)
create policy "own profile" on public.profiles
  for all using (auth.uid() = id) with check (auth.uid() = id);

create policy "own transactions" on public.transactions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own snapshots read" on public.portfolio_snapshots
  for select using (auth.uid() = user_id);

create policy "assets readable" on public.assets for select to authenticated using (true);
create policy "prices readable" on public.asset_prices for select to authenticated using (true);
create policy "fx readable"     on public.fx_rates    for select to authenticated using (true);

create policy "admin manages assets" on public.assets
  for all to authenticated using (public.has_role(auth.uid(),'admin'))
  with check (public.has_role(auth.uid(),'admin'));

create policy "admin sees failures" on public.price_fetch_failures
  for all to authenticated using (public.has_role(auth.uid(),'admin'));
```

---

## 3. Mapa de Rotas da Aplicação

```text
/                              Landing pública (pitch + CTA)
/login                         Login (email/senha + Google)
/signup                        Cadastro
/reset-password                Recuperação de senha

_authenticated/                Gate de sessão (free + premium + admin)
  /dashboard                   Visão geral (KPIs, gráficos, alocação)
  /transactions                Lista de lançamentos + filtros por classe
  /transactions/new            Modal/rota para novo lançamento
  /transactions/$id            Editar / excluir
  /assets                      Tabela detalhada por categoria
  /analytics                   Aportes vs retiradas, evolução
  /settings                    Moeda base, preferências, conta
  /upgrade                     Paywall Free → Premium

_authenticated/_premium/       Gate adicional (premium-only)
  /analytics/advanced          Métricas avançadas, exportações
  /alerts                      Alertas de preço

_authenticated/_admin/         Gate admin
  /admin                       Dashboard administrativo
  /admin/users                 Gestão de usuários e roles
  /admin/assets                CRUD do catálogo de ativos
  /admin/price-failures        Fila de falhas de cotação (fallback manual)
  /admin/data-sources          Configuração de fontes (Yahoo/Google/etc.)
  /admin/feature-flags         Limites Free vs Premium

api/public/                    Endpoints externos (sem auth de sessão)
  /api/public/cron/prices      Cron horário — atualiza preços
  /api/public/cron/fx          Cron diário — atualiza câmbio
  /api/public/cron/snapshots   Cron diário — snapshot de patrimônio
```

**Server functions principais** (`src/lib/*.functions.ts`):
- `getDashboard` — KPIs + séries, convertidos para moeda escolhida
- `listTransactions`, `createTransaction`, `updateTransaction`, `deleteTransaction`
- `getAllocationByClass`, `getEquityCurve`, `getMonthlyFlows`
- `searchAssets` — autocomplete (Yahoo/Google)
- `adminListPriceFailures`, `adminSetManualPrice`, `adminAssignRole`

---

## 4. Motor de Preços (resumo)

- **Cron horário** → para cada `asset_id` distinto em `transactions`, busca preço (Yahoo → Google → CoinGecko). Sucesso grava em `asset_prices`; falha cria linha em `price_fetch_failures`.
- **Cron diário (FX)** → popula `fx_rates` com pares base × {BRL,USD,EUR,...}.
- **Cron diário (snapshot)** → calcula `portfolio_snapshots` por usuário/moeda base.
- **Conversão em tempo real no dashboard** → server fn `getDashboard({ displayCurrency })` aplica `fx_rates` mais recente; nenhuma conversão é persistida no lançamento original.

---

## Próximo passo
Posso começar implementando: (1) habilitar Lovable Cloud, (2) criar a migration com o schema acima, (3) montar o shell de rotas com gates RBAC, e (4) o Dashboard com dados mock até o motor de preços ficar pronto. Confirma se essa direção está boa ou se quer ajustar algo (ex.: trocar fontes de cotação, adicionar outra moeda, mudar limites Free)?
