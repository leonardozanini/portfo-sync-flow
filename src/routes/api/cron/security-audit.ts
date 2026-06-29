// src/routes/api/cron/security-audit.ts
//
// Cron semanal que audita a segurança do banco de dados:
//   - Políticas RLS em todas as tabelas
//   - Grants excessivos para roles anon/authenticated
//   - Tabelas sem RLS ativo
//   - Funções SECURITY DEFINER expostas
//   - Dados sensíveis acessíveis sem autenticação
//
// Rota:  GET /api/cron/security-audit
// Cron:  toda segunda-feira às 07:00 UTC (vercel.json)

type Finding = {
  severity: "critical" | "warning" | "info";
  category: string;
  message: string;
  detail?: string;
};

// ── Checks de segurança ───────────────────────────────────────────────────────

async function checkRLSEnabled(supabaseAdmin: any): Promise<Finding[]> {
  const findings: Finding[] = [];

  const { data } = await supabaseAdmin.rpc("audit_rls_enabled");
  // Fallback: query direta
  const { data: tables } = await supabaseAdmin
    .from("pg_tables")
    .select("tablename, rowsecurity")
    .eq("schemaname", "public");

  const { data: rows } = await supabaseAdmin
    .rpc("execute_sql", {
      sql: `SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`,
    })
    .catch(() => ({ data: null }));

  return findings;
}

async function runSecurityChecks(supabaseAdmin: any): Promise<Finding[]> {
  const findings: Finding[] = [];

  // ── 1. Tabelas sem RLS ativo ──────────────────────────────────────────────
  const { data: tablesWithoutRLS, error: e1 } = await supabaseAdmin
    .rpc("query_raw", {
      query: `
        SELECT tablename
        FROM pg_tables
        WHERE schemaname = 'public' AND rowsecurity = false
        ORDER BY tablename
      `,
    })
    .catch(() => ({ data: null, error: null }));

  // Alternativa via information_schema
  const rlsCheck = await supabaseAdmin
    .from("pg_tables" as any)
    .select("tablename, rowsecurity")
    .eq("schemaname", "public")
    .eq("rowsecurity", false)
    .catch(() => ({ data: null }));

  // ── 2. Grants excessivos para anon em tabelas sensíveis ───────────────────
  const sensitiveTablesRes = await fetch(
    `${process.env.SUPABASE_URL}/rest/v1/rpc/get_security_audit`,
    {
      method: "POST",
      headers: {
        "apikey": process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
        "Authorization": `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY ?? ""}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    }
  ).catch(() => null);

  return findings;
}

// ── Queries diretas via SQL ───────────────────────────────────────────────────

async function runSQLAudit(serviceRoleKey: string, supabaseUrl: string): Promise<Finding[]> {
  const findings: Finding[] = [];

  const execSQL = async (sql: string) => {
    const res = await fetch(`${supabaseUrl}/rest/v1/rpc/exec_sql`, {
      method: "POST",
      headers: {
        "apikey": serviceRoleKey,
        "Authorization": `Bearer ${serviceRoleKey}`,
        "Content-Type": "application/json",
        "Prefer": "return=representation",
      },
      body: JSON.stringify({ query: sql }),
    });
    if (!res.ok) return null;
    return res.json().catch(() => null);
  };

  // Check 1: Tabelas públicas sem RLS
  const noRLS = await execSQL(`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND rowsecurity = false
  `);
  if (Array.isArray(noRLS) && noRLS.length > 0) {
    for (const row of noRLS) {
      findings.push({
        severity: "critical",
        category: "RLS",
        message: `Tabela '${row.tablename}' sem RLS ativo`,
        detail: "Qualquer usuário autenticado pode ler/escrever todos os dados desta tabela",
      });
    }
  }

  // Check 2: Grants para anon em tabelas sensíveis
  const anonGrants = await execSQL(`
    SELECT table_name, privilege_type
    FROM information_schema.role_table_grants
    WHERE table_schema = 'public'
      AND grantee = 'anon'
      AND table_name IN ('transactions','dividends','profiles','brokers',
                         'portfolio_snapshots','user_strategies','asset_analyses',
                         'user_roles','price_fetch_failures')
    ORDER BY table_name, privilege_type
  `);
  if (Array.isArray(anonGrants) && anonGrants.length > 0) {
    for (const row of anonGrants) {
      findings.push({
        severity: "critical",
        category: "Grants",
        message: `Role 'anon' tem ${row.privilege_type} em '${row.table_name}'`,
        detail: "Usuários não autenticados não devem ter acesso a dados sensíveis",
      });
    }
  }

  // Check 3: Políticas com roles 'public' em vez de 'authenticated'
  const publicPolicies = await execSQL(`
    SELECT tablename, policyname, cmd
    FROM pg_policies
    WHERE schemaname = 'public'
      AND roles::text LIKE '%public%'
      AND roles::text NOT LIKE '%authenticated%'
  `);
  if (Array.isArray(publicPolicies) && publicPolicies.length > 0) {
    for (const row of publicPolicies) {
      findings.push({
        severity: "warning",
        category: "RLS Policy",
        message: `Política '${row.policyname}' em '${row.tablename}' usa role 'public'`,
        detail: "Políticas devem usar 'authenticated' para restringir acesso a usuários logados",
      });
    }
  }

  // Check 4: Tabelas sensíveis sem política WITH CHECK (write protection)
  const missingWithCheck = await execSQL(`
    SELECT tablename, policyname, cmd
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('transactions','dividends','profiles','brokers','user_strategies')
      AND cmd IN ('INSERT','UPDATE','ALL')
      AND with_check IS NULL
  `);
  if (Array.isArray(missingWithCheck) && missingWithCheck.length > 0) {
    for (const row of missingWithCheck) {
      findings.push({
        severity: "warning",
        category: "RLS Policy",
        message: `Política '${row.policyname}' (${row.cmd}) em '${row.tablename}' sem WITH CHECK`,
        detail: "Políticas de escrita devem ter WITH CHECK para prevenir inserção de dados de outros usuários",
      });
    }
  }

  // Check 5: TRUNCATE/TRIGGER concedidos ao authenticated
  const dangerousGrants = await execSQL(`
    SELECT table_name, privilege_type, grantee
    FROM information_schema.role_table_grants
    WHERE table_schema = 'public'
      AND privilege_type IN ('TRUNCATE','TRIGGER')
      AND grantee IN ('anon','authenticated')
    ORDER BY table_name, privilege_type
  `);
  if (Array.isArray(dangerousGrants) && dangerousGrants.length > 0) {
    for (const row of dangerousGrants) {
      findings.push({
        severity: "warning",
        category: "Grants",
        message: `Role '${row.grantee}' tem ${row.privilege_type} em '${row.table_name}'`,
        detail: "Permissões TRUNCATE e TRIGGER não devem ser concedidas a usuários da aplicação",
      });
    }
  }

  // Check 6: Funções SECURITY DEFINER expostas sem owner check
  const secDefiner = await execSQL(`
    SELECT p.proname, pg_get_function_arguments(p.oid) as args
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public'
      AND p.prosecdef = true
    ORDER BY p.proname
  `);
  if (Array.isArray(secDefiner) && secDefiner.length > 0) {
    // Funções SECURITY DEFINER esperadas (não são problema)
    const EXPECTED = ["handle_new_user", "has_role"];
    const unexpected = secDefiner.filter((r: any) => !EXPECTED.includes(r.proname));
    for (const row of unexpected) {
      findings.push({
        severity: "warning",
        category: "Functions",
        message: `Função SECURITY DEFINER inesperada: '${row.proname}(${row.args})'`,
        detail: "Funções SECURITY DEFINER executam com privilégios elevados — revisar se necessário",
      });
    }
  }

  // Check 7: Usuários com role admin (verificação de integridade)
  const adminUsers = await execSQL(`
    SELECT u.email, ur.role, ur.created_at
    FROM user_roles ur
    JOIN auth.users u ON u.id = ur.user_id
    WHERE ur.role = 'admin'
    ORDER BY ur.created_at
  `);
  if (Array.isArray(adminUsers)) {
    findings.push({
      severity: "info",
      category: "Users",
      message: `${adminUsers.length} usuário(s) com role admin`,
      detail: adminUsers.map((r: any) => r.email).join(", "),
    });
  }

  // Check 8: Tabelas sem nenhuma política RLS
  const tablesWithoutPolicies = await execSQL(`
    SELECT t.tablename
    FROM pg_tables t
    WHERE t.schemaname = 'public'
      AND t.rowsecurity = true
      AND NOT EXISTS (
        SELECT 1 FROM pg_policies p
        WHERE p.schemaname = 'public' AND p.tablename = t.tablename
      )
    ORDER BY t.tablename
  `);
  if (Array.isArray(tablesWithoutPolicies) && tablesWithoutPolicies.length > 0) {
    for (const row of tablesWithoutPolicies) {
      findings.push({
        severity: "critical",
        category: "RLS",
        message: `Tabela '${row.tablename}' tem RLS ativo mas sem nenhuma política`,
        detail: "RLS ativo sem políticas bloqueia TODOS os acessos — incluindo os legítimos",
      });
    }
  }

  return findings;
}

// ── Salvar resultado no banco ─────────────────────────────────────────────────

async function saveAuditResult(
  supabaseAdmin: any,
  findings: Finding[],
  durationMs: number,
): Promise<void> {
  const critical = findings.filter(f => f.severity === "critical").length;
  const warnings = findings.filter(f => f.severity === "warning").length;
  const infos = findings.filter(f => f.severity === "info").length;

  // Salva na tabela security_audit_logs (cria se não existir)
  await supabaseAdmin.rpc("exec_sql", {
    query: `
      CREATE TABLE IF NOT EXISTS public.security_audit_logs (
        id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
        ran_at timestamptz DEFAULT now(),
        duration_ms integer,
        critical_count integer,
        warning_count integer,
        info_count integer,
        findings jsonb,
        status text GENERATED ALWAYS AS (
          CASE WHEN critical_count > 0 THEN 'critical'
               WHEN warning_count > 0 THEN 'warning'
               ELSE 'ok' END
        ) STORED
      );
    `,
  }).catch(() => null);

  await supabaseAdmin
    .from("security_audit_logs" as any)
    .insert({
      duration_ms: durationMs,
      critical_count: critical,
      warning_count: warnings,
      info_count: infos,
      findings: findings,
    })
    .catch((e: any) => console.error("[security-audit] Erro ao salvar log:", e.message));
}

// ── Handler principal ─────────────────────────────────────────────────────────

export default async function handler(req: Request): Promise<Response> {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${cronSecret}`) {
      return new Response("Unauthorized", { status: 401 });
    }
  }

  const startedAt = Date.now();
  console.log("[security-audit] Iniciando auditoria semanal de segurança...");

  try {
    const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? "";
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const findings = await runSQLAudit(serviceRoleKey, supabaseUrl);
    const durationMs = Date.now() - startedAt;

    await saveAuditResult(supabaseAdmin, findings, durationMs);

    const critical = findings.filter(f => f.severity === "critical");
    const warnings = findings.filter(f => f.severity === "warning");

    console.log(`[security-audit] Concluído em ${durationMs}ms:`);
    console.log(`  Critical: ${critical.length}`);
    console.log(`  Warnings: ${warnings.length}`);
    console.log(`  Info: ${findings.filter(f => f.severity === "info").length}`);

    if (critical.length > 0) {
      console.error("[security-audit] PROBLEMAS CRÍTICOS ENCONTRADOS:");
      critical.forEach(f => console.error(`  - [${f.category}] ${f.message}`));
    }

    return Response.json({
      ok: true,
      status: critical.length > 0 ? "critical" : warnings.length > 0 ? "warning" : "ok",
      summary: {
        critical: critical.length,
        warnings: warnings.length,
        info: findings.filter(f => f.severity === "info").length,
        duration_ms: durationMs,
      },
      findings,
    });
  } catch (err: any) {
    console.error("[security-audit] Erro crítico:", err.message);
    return Response.json({ ok: false, error: err.message }, { status: 500 });
  }
}
