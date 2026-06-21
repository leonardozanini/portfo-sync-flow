import { createFileRoute } from "@tanstack/react-router";
import React, { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Brain, Search, FileUp, Loader2, Clock, ChevronDown, ChevronUp,
  AlertTriangle, Trash2, TrendingUp, Building2, Globe, BarChart3,
} from "lucide-react";
import { toast } from "sonner";
import { analyzeAsset, listAnalyses, deleteAnalysis, askFollowUp } from "@/lib/portfolio.functions";

// ── Frameworks de análise disponíveis ────────────────────────────────────────

const FRAMEWORKS = [
  {
    id: "fundamentalista",
    label: "Fundamentalista Geral",
    icon: TrendingUp,
    description: "Qualidade do lucro, retorno sobre capital e risco",
  },
  {
    id: "bancos",
    label: "Bancos & Financeiras",
    icon: Building2,
    description: "ROTCE, NIM, NPL, CET1, eficiência operacional",
  },
  {
    id: "fiis",
    label: "FIIs & REITs",
    icon: Building2,
    description: "Cap rate, vacância, qualidade dos ativos, dividend yield",
  },
  {
    id: "tech",
    label: "Tecnologia",
    icon: Globe,
    description: "Crescimento de receita, margens, unit economics, moat",
  },
  {
    id: "macro",
    label: "Visão Macro",
    icon: BarChart3,
    description: "Posicionamento macro, sensibilidade a juros e câmbio",
  },
];

export const Route = createFileRoute("/_authenticated/analise")({
  head: () => ({ meta: [{ title: "Análise IA — Folio" }] }),
  component: AnalisePage,
});

// ── Formatação do resultado em markdown simples ───────────────────────────────

// Renderiza inline: **negrito**, *itálico*, emojis
function renderInline(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const regex = /(\*\*[^*]+\*\*|\*[^*]+\*)/g;
  let last = 0;
  let match;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    const raw = match[0];
    if (raw.startsWith("**")) {
      parts.push(<strong key={match.index} className="font-semibold text-foreground">{raw.slice(2, -2)}</strong>);
    } else {
      parts.push(<em key={match.index} className="italic">{raw.slice(1, -1)}</em>);
    }
    last = match.index + raw.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

// Detecta se uma linha faz parte de uma tabela markdown
function isTableRow(line: string) {
  return line.trim().startsWith("|") && line.trim().endsWith("|");
}

function isSeparatorRow(line: string) {
  return /^\|[\s\-|:]+\|$/.test(line.trim());
}

function AnalysisResult({ text }: { text: string }) {
  const lines = text.split("\n");
  const elements: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Título H2
    if (line.startsWith("## ")) {
      elements.push(
        <h2 key={i} className="text-base font-bold mt-5 mb-2 text-foreground border-b border-border pb-1">
          {renderInline(line.slice(3))}
        </h2>
      );
      i++; continue;
    }

    // Título H3
    if (line.startsWith("### ")) {
      elements.push(
        <h3 key={i} className="text-sm font-semibold mt-4 mb-1 text-foreground">
          {renderInline(line.slice(4))}
        </h3>
      );
      i++; continue;
    }

    // Título H4
    if (line.startsWith("#### ")) {
      elements.push(
        <h4 key={i} className="text-sm font-medium mt-3 mb-1 text-foreground">
          {renderInline(line.slice(5))}
        </h4>
      );
      i++; continue;
    }

    // Tabela markdown — agrupa todas as linhas da tabela
    if (isTableRow(line)) {
      const tableLines: string[] = [];
      while (i < lines.length && (isTableRow(lines[i]) || isSeparatorRow(lines[i]))) {
        tableLines.push(lines[i]);
        i++;
      }
      const rows = tableLines.filter(l => !isSeparatorRow(l));
      const headers = rows[0]?.split("|").filter(c => c.trim() !== "").map(c => c.trim()) ?? [];
      const bodyRows = rows.slice(1);
      elements.push(
        <div key={`table-${i}`} className="overflow-x-auto my-3 rounded-lg border border-border">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-muted/50">
                {headers.map((h, j) => (
                  <th key={j} className="px-3 py-2 text-left font-semibold text-foreground whitespace-nowrap">
                    {renderInline(h)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {bodyRows.map((row, ri) => {
                const cells = row.split("|").filter(c => c.trim() !== "").map(c => c.trim());
                return (
                  <tr key={ri} className="border-t border-border hover:bg-muted/20">
                    {cells.map((cell, ci) => (
                      <td key={ci} className="px-3 py-2 text-muted-foreground whitespace-nowrap">
                        {renderInline(cell)}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      );
      continue;
    }

    // Lista com bullet
    if (line.startsWith("- ") || line.startsWith("• ") || line.match(/^\d+\.\s/)) {
      const listItems: string[] = [];
      const isOrdered = line.match(/^\d+\.\s/);
      while (i < lines.length && (lines[i].startsWith("- ") || lines[i].startsWith("• ") || lines[i].match(/^\d+\.\s/))) {
        const l = lines[i];
        listItems.push(l.replace(/^[-•]\s/, "").replace(/^\d+\.\s/, ""));
        i++;
      }
      const Tag = isOrdered ? "ol" : "ul";
      elements.push(
        <Tag key={`list-${i}`} className={`my-2 space-y-1 pl-5 ${isOrdered ? "list-decimal" : "list-disc"}`}>
          {listItems.map((item, j) => (
            <li key={j} className="text-sm text-muted-foreground">{renderInline(item)}</li>
          ))}
        </Tag>
      );
      continue;
    }

    // Linha em branco
    if (line.trim() === "") {
      elements.push(<div key={i} className="h-2" />);
      i++; continue;
    }

    // Linha só com negrito (funciona como subtítulo)
    if (line.trim().startsWith("**") && line.trim().endsWith("**")) {
      elements.push(
        <p key={i} className="text-sm font-semibold text-foreground mt-2">
          {renderInline(line.trim())}
        </p>
      );
      i++; continue;
    }

    // Parágrafo normal
    elements.push(
      <p key={i} className="text-sm text-muted-foreground leading-relaxed">
        {renderInline(line)}
      </p>
    );
    i++;
  }

  return <div className="space-y-1">{elements}</div>;
}

// ── Card de análise salva ─────────────────────────────────────────────────────

function AnalysisCard({ analysis, onDelete }: { analysis: any; onDelete: (id: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const framework = FRAMEWORKS.find(f => f.id === analysis.framework);

  return (
    <Card className="overflow-hidden">
      <button
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/30 transition-colors text-left"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-3 min-w-0">
          <span className="font-mono font-bold text-sm">{analysis.ticker}</span>
          <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">
            {framework?.label ?? analysis.framework}
          </span>
          <span className="text-xs text-muted-foreground hidden sm:block">
            {analysis.mode === "web" ? "🌐 Web" : analysis.mode === "pdf" ? "📄 PDF" : "🌐+📄 Ambos"}
          </span>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <span className="text-xs text-muted-foreground flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {new Date(analysis.created_at).toLocaleDateString("pt-BR")}
          </span>
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(analysis.id); }}
            className="p-1 rounded hover:bg-destructive/10 hover:text-destructive text-muted-foreground transition-colors"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
          {expanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
        </div>
      </button>
      {expanded && (
        <div className="px-4 pb-4 border-t border-border pt-3">
          <AnalysisResult text={analysis.result} />
        </div>
      )}
    </Card>
  );
}


// ── Tipos do chat ─────────────────────────────────────────────────────────────

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

// ── Chat de follow-up ─────────────────────────────────────────────────────────

function FollowUpChat({ analysisText, ticker }: { analysisText: string; ticker: string }) {
  const askFn = useServerFn(askFollowUp);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const scrollToBottom = () => {
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
  };

  const send = async () => {
    const question = input.trim();
    if (!question || loading) return;

    const newMessages: ChatMessage[] = [...messages, { role: "user", content: question }];
    setMessages(newMessages);
    setInput("");
    setLoading(true);
    scrollToBottom();

    try {
      const data = await askFn({
        data: { ticker, analysisText, messages: newMessages },
      });
      setMessages(prev => [...prev, { role: "assistant", content: (data as any).answer }]);
      scrollToBottom();
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao responder pergunta");
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  };

  return (
    <div className="border-t border-border pt-4 space-y-3">
      <div className="flex items-center gap-2">
        <Brain className="h-4 w-4 text-primary" />
        <span className="text-sm font-medium text-foreground">Perguntas sobre a análise</span>
        <span className="text-xs text-muted-foreground">— tire dúvidas com base no que foi analisado</span>
      </div>

      {/* Histórico de mensagens */}
      {messages.length > 0 && (
        <div className="space-y-3 max-h-[400px] overflow-y-auto pr-1">
          {messages.map((msg, i) => (
            <div key={i} className={`flex gap-3 ${msg.role === "user" ? "flex-row-reverse" : "flex-row"}`}>
              <div className={`h-7 w-7 rounded-full shrink-0 grid place-items-center text-xs font-bold ${
                msg.role === "user"
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground"
              }`}>
                {msg.role === "user" ? "V" : "IA"}
              </div>
              <div className={`flex-1 rounded-xl px-3 py-2 text-sm max-w-[85%] ${
                msg.role === "user"
                  ? "bg-primary/10 text-foreground ml-auto"
                  : "bg-muted/50 text-foreground"
              }`}>
                {msg.role === "assistant"
                  ? <AnalysisResult text={msg.content} />
                  : <p>{msg.content}</p>
                }
              </div>
            </div>
          ))}
          {loading && (
            <div className="flex gap-3">
              <div className="h-7 w-7 rounded-full shrink-0 grid place-items-center bg-muted">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
              </div>
              <div className="bg-muted/50 rounded-xl px-3 py-2 text-sm text-muted-foreground">
                Analisando sua pergunta…
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      )}

      {/* Input */}
      <div className="flex gap-2">
        <Input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && send()}
          placeholder={`Pergunte sobre a análise de ${ticker}… (ex: O que é NIM ajustado ao risco?)`}
          disabled={loading}
          className="flex-1 text-sm"
        />
        <Button
          onClick={send}
          disabled={!input.trim() || loading}
          size="icon"
          className="shrink-0"
        >
          {loading
            ? <Loader2 className="h-4 w-4 animate-spin" />
            : <Search className="h-4 w-4" />
          }
        </Button>
      </div>

      {messages.length === 0 && (
        <div className="flex flex-wrap gap-2">
          {[
            "O que significa NIM ajustado ao risco?",
            "Como o NPL 15-90 impacta o resultado?",
            "Explique o coverage ratio em mais detalhes",
            "Quais são os principais riscos identificados?",
          ].map((suggestion) => (
            <button
              key={suggestion}
              onClick={() => { setInput(suggestion); inputRef.current?.focus(); }}
              className="text-xs px-3 py-1.5 rounded-full border border-border text-muted-foreground hover:border-primary/50 hover:text-foreground transition-colors"
            >
              {suggestion}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Página principal ──────────────────────────────────────────────────────────

function AnalisePage() {
  const qc = useQueryClient();
  const analyzeFn = useServerFn(analyzeAsset);
  const listFn = useServerFn(listAnalyses);
  const deleteFn = useServerFn(deleteAnalysis);
  const fileRef = useRef<HTMLInputElement>(null);

  const [ticker, setTicker] = useState("");
  const [framework, setFramework] = useState("fundamentalista");
  const [mode, setMode] = useState<"web" | "pdf" | "both">("web");
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const { data: analyses = [], isLoading: analysesLoading } = useQuery({
    queryKey: ["analyses"],
    queryFn: () => listFn(),
    staleTime: 60_000,
  });

  const mutation = useMutation({
    mutationFn: async () => {
      let pdfBase64: string | undefined;
      let pdfName: string | undefined;

      if ((mode === "pdf" || mode === "both") && pdfFile) {
        pdfBase64 = await new Promise<string>((res, rej) => {
          const reader = new FileReader();
          reader.onload = () => res((reader.result as string).split(",")[1]);
          reader.onerror = () => rej(new Error("Erro ao ler arquivo"));
          reader.readAsDataURL(pdfFile);
        });
        pdfName = pdfFile.name;
      }

      const data = await analyzeFn({
        data: { ticker: ticker.trim().toUpperCase(), framework, mode, pdfBase64, pdfName },
      });
      return data;
    },
    onSuccess: (data: any) => {
      setResult(data.result);
      qc.invalidateQueries({ queryKey: ["analyses"] });
      toast.success("Análise concluída!");
    },
    onError: (e: any) => toast.error(e.message ?? "Erro ao gerar análise"),
  });

  const handleDelete = async (id: string) => {
    await deleteFn({ data: { id } });
    qc.invalidateQueries({ queryKey: ["analyses"] });
    toast.success("Análise removida.");
  };

  const selectedFramework = FRAMEWORKS.find(f => f.id === framework);

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-start gap-3">
        <div className="grid h-10 w-10 place-items-center rounded-xl bg-primary/10 shrink-0">
          <Brain className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Análise com IA</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Análise fundamentalista assistida por inteligência artificial
          </p>
        </div>
      </div>

      {/* Disclaimer */}
      <Card className="border-amber-500/30 bg-amber-500/5">
        <CardContent className="py-3 px-4 flex items-start gap-3">
          <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
          <p className="text-xs text-muted-foreground">
            <span className="font-semibold text-amber-600 dark:text-amber-400">Aviso importante: </span>
            As análises geradas por IA são apenas auxiliares e <strong>não constituem recomendação de investimento</strong>.
            Sempre consulte um profissional certificado antes de tomar decisões financeiras.
          </p>
        </CardContent>
      </Card>

      {/* Formulário */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Nova análise</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Ticker */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Ticker do ativo</Label>
              <Input
                value={ticker}
                onChange={(e) => setTicker(e.target.value.toUpperCase())}
                placeholder="Ex: ITSA4, JPM, NU, CPTS11"
                className="font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Framework de análise</Label>
              <Select value={framework} onValueChange={setFramework}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {FRAMEWORKS.map(f => (
                    <SelectItem key={f.id} value={f.id}>
                      <div className="flex flex-col">
                        <span>{f.label}</span>
                        <span className="text-xs text-muted-foreground">{f.description}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Modo */}
          <div className="space-y-1.5">
            <Label>Fonte de dados</Label>
            <Tabs value={mode} onValueChange={(v) => setMode(v as any)}>
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="web" className="gap-2">
                  <Search className="h-3.5 w-3.5" /> Busca Web
                </TabsTrigger>
                <TabsTrigger value="pdf" className="gap-2">
                  <FileUp className="h-3.5 w-3.5" /> Upload PDF
                </TabsTrigger>
                <TabsTrigger value="both" className="gap-2">
                  <Brain className="h-3.5 w-3.5" /> Ambos
                </TabsTrigger>
              </TabsList>

              <TabsContent value="web" className="mt-3">
                <p className="text-xs text-muted-foreground">
                  Claude busca automaticamente notícias, resultados e dados públicos recentes do ativo na web.
                </p>
              </TabsContent>

              <TabsContent value="pdf" className="mt-3 space-y-2">
                <p className="text-xs text-muted-foreground">
                  Faça upload do relatório de resultados, earnings release ou qualquer documento relevante.
                  Recomendado para análise mais precisa com dados oficiais.
                </p>
                <div
                  onClick={() => fileRef.current?.click()}
                  className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
                    pdfFile ? "border-primary/50 bg-primary/5" : "border-border hover:border-primary/30"
                  }`}
                >
                  <FileUp className="h-6 w-6 mx-auto mb-2 text-muted-foreground" />
                  {pdfFile ? (
                    <div>
                      <p className="text-sm font-medium text-foreground">{pdfFile.name}</p>
                      <p className="text-xs text-muted-foreground">{(pdfFile.size / 1024 / 1024).toFixed(2)} MB</p>
                    </div>
                  ) : (
                    <div>
                      <p className="text-sm text-muted-foreground">Clique para selecionar um PDF</p>
                      <p className="text-xs text-muted-foreground mt-1">Máximo 20MB</p>
                    </div>
                  )}
                  <input
                    ref={fileRef}
                    type="file"
                    accept=".pdf"
                    className="hidden"
                    onChange={(e) => setPdfFile(e.target.files?.[0] ?? null)}
                  />
                </div>
              </TabsContent>

              <TabsContent value="both" className="mt-3 space-y-2">
                <p className="text-xs text-muted-foreground">
                  Combina busca web com o documento enviado para uma análise mais completa.
                </p>
                <div
                  onClick={() => fileRef.current?.click()}
                  className={`border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-colors ${
                    pdfFile ? "border-primary/50 bg-primary/5" : "border-border hover:border-primary/30"
                  }`}
                >
                  <FileUp className="h-5 w-5 mx-auto mb-1 text-muted-foreground" />
                  {pdfFile ? (
                    <p className="text-sm font-medium text-foreground">{pdfFile.name}</p>
                  ) : (
                    <p className="text-sm text-muted-foreground">Clique para selecionar um PDF (opcional)</p>
                  )}
                  <input
                    ref={fileRef}
                    type="file"
                    accept=".pdf"
                    className="hidden"
                    onChange={(e) => setPdfFile(e.target.files?.[0] ?? null)}
                  />
                </div>
              </TabsContent>
            </Tabs>
          </div>

          {/* Botão */}
          <Button
            className="w-full"
            onClick={() => mutation.mutate()}
            disabled={!ticker.trim() || mutation.isPending || ((mode === "pdf") && !pdfFile)}
          >
            {mutation.isPending ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Analisando… isso pode levar alguns segundos</>
            ) : (
              <><Brain className="mr-2 h-4 w-4" />Gerar Análise</>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* Resultado atual + chat de follow-up */}
      {result && (
        <Card className="border-primary/20">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Brain className="h-4 w-4 text-primary" />
              Análise de {ticker} — {selectedFramework?.label}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <AnalysisResult text={result} />
            <FollowUpChat analysisText={result} ticker={ticker} />
          </CardContent>
        </Card>
      )}

      {/* Histórico */}
      {analysesLoading && (
        <div className="space-y-3">
          <div className="h-5 w-44 animate-pulse rounded-md bg-muted/60" />
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="rounded-xl border border-border bg-card p-5 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="h-8 w-8 animate-pulse rounded-lg bg-muted/60" />
                  <div className="space-y-1.5">
                    <div className="h-4 w-24 animate-pulse rounded bg-muted/60" />
                    <div className="h-3 w-32 animate-pulse rounded bg-muted/60" />
                  </div>
                </div>
                <div className="h-7 w-7 animate-pulse rounded bg-muted/60" />
              </div>
              <div className="space-y-2">
                <div className="h-3 w-full animate-pulse rounded bg-muted/60" />
                <div className="h-3 w-5/6 animate-pulse rounded bg-muted/60" />
                <div className="h-3 w-4/6 animate-pulse rounded bg-muted/60" />
              </div>
            </div>
          ))}
        </div>
      )}

      {!analysesLoading && (analyses as any[]).length > 0 && (
        <div className="space-y-3">
          <h2 className="text-base font-semibold">Histórico de análises</h2>
          {(analyses as any[]).map((a) => (
            <AnalysisCard key={a.id} analysis={a} onDelete={handleDelete} />
          ))}
        </div>
      )}
    </div>
  );
}
