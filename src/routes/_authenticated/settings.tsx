import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Check, Loader2, Globe, Landmark, Plus, Pencil, Trash2, Wallet, X,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useDisplayCurrency } from "@/components/CurrencySwitcher";
import { CURRENCIES, type Currency } from "@/lib/currency";
import { listBrokers, createBroker, updateBroker, deleteBroker } from "@/lib/portfolio.functions";
import { toast } from "sonner";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from "@/components/ui/alert-dialog";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({ meta: [{ title: "Ajustes — Folio" }] }),
  component: SettingsPage,
});

function SettingsPage() {
  const { user, roles } = useAuth();
  const { defaultCurrency, setDefaultCurrency, setCurrency } = useDisplayCurrency();

  const [selected, setSelected] = useState<Currency>(defaultCurrency);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const isDirty = selected !== defaultCurrency;

  const handleSave = async () => {
    setSaving(true);
    try {
      await setDefaultCurrency(selected);
      setSaved(true);
      toast.success("Moeda padrão atualizada!");
      setTimeout(() => setSaved(false), 2500);
    } catch {
      toast.error("Erro ao salvar preferência.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Ajustes</h1>
        <p className="text-sm text-muted-foreground">Preferências da sua conta.</p>
      </div>

      {/* Conta */}
      <Card>
        <CardHeader>
          <CardTitle>Conta</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div><span className="text-muted-foreground">Email: </span>{user?.email}</div>
          <div><span className="text-muted-foreground">Papéis: </span>{roles.join(", ") || "free"}</div>
        </CardContent>
      </Card>

      {/* Moeda padrão */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Globe className="h-4 w-4 text-primary" />
            Moeda padrão da carteira
          </CardTitle>
          <CardDescription>
            A moeda que aparece selecionada por padrão ao abrir o Folio. Você pode trocar temporariamente
            a qualquer momento pelo seletor no topo da tela.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4">
            <Select value={selected} onValueChange={(v) => { setSelected(v as Currency); setSaved(false); }}>
              <SelectTrigger className="w-[160px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CURRENCIES.map((c) => (
                  <SelectItem key={c.code} value={c.code}>
                    <span className="font-mono font-semibold mr-1">{c.symbol}</span> {c.code}
                    {c.code === defaultCurrency && (
                      <span className="ml-2 text-xs text-muted-foreground">(atual)</span>
                    )}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Button
              onClick={handleSave}
              disabled={!isDirty || saving}
              size="sm"
              variant={saved ? "outline" : "default"}
            >
              {saving ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Salvando...</>
              ) : saved ? (
                <><Check className="mr-2 h-4 w-4 text-emerald-500" /> Salvo!</>
              ) : (
                "Salvar preferência"
              )}
            </Button>
          </div>

          {isDirty && !saving && (
            <p className="mt-3 text-xs text-muted-foreground">
              Ao salvar, o Folio sempre abrirá exibindo os valores em{" "}
              <span className="font-semibold text-foreground">{selected}</span>.
            </p>
          )}
        </CardContent>
      </Card>

      <BrokersCard />
    </div>
  );
}

// ── Corretoras e Wallets ──────────────────────────────────────────────────────

const BROKER_TYPE_LABEL: Record<string, string> = {
  broker: "Corretora (nacional)",
  brazil: "Corretora (Brasil)",
  international: "Corretora (internacional)",
  wallet: "Wallet própria (self-custody)",
};

const DEFAULT_COLORS = ["#6366f1", "#ec4899", "#22c55e", "#f59e0b", "#0ea5e9", "#8b5cf6", "#ef4444", "#14b8a6"];

function BrokersCard() {
  const qc = useQueryClient();
  const listFn = useServerFn(listBrokers);
  const createFn = useServerFn(createBroker);
  const updateFn = useServerFn(updateBroker);
  const deleteFn = useServerFn(deleteBroker);

  const { data: brokers = [], isLoading, refetch } = useQuery({
    queryKey: ["brokers"],
    queryFn: () => listFn(),
    staleTime: 30_000,
  });

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [type, setType] = useState("broker");
  const [color, setColor] = useState(DEFAULT_COLORS[0]);
  const [saving, setSaving] = useState(false);
  const [toDelete, setToDelete] = useState<{ id: string; name: string } | null>(null);

  const resetForm = () => {
    setShowForm(false);
    setEditingId(null);
    setName("");
    setType("broker");
    setColor(DEFAULT_COLORS[0]);
  };

  const startEdit = (b: any) => {
    setEditingId(b.id);
    setName(b.name);
    setType(b.type);
    setColor(b.color);
    setShowForm(true);
  };

  const handleSubmit = async () => {
    if (!name.trim()) { toast.error("Informe um nome"); return; }
    setSaving(true);
    try {
      if (editingId) {
        await updateFn({ data: { id: editingId, name: name.trim(), type, country: "BR", color } });
        toast.success("Atualizado!");
      } else {
        await createFn({ data: { name: name.trim(), type, country: "BR", color } });
        toast.success(`"${name.trim()}" adicionado!`);
      }
      qc.invalidateQueries({ queryKey: ["brokers"] });
      resetForm();
      refetch();
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao salvar");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!toDelete) return;
    try {
      await deleteFn({ data: { id: toDelete.id } });
      toast.success("Removido!");
      qc.invalidateQueries({ queryKey: ["brokers"] });
      refetch();
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao remover");
    } finally {
      setToDelete(null);
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Landmark className="h-4 w-4 text-primary" />
            Corretoras e Wallets
          </CardTitle>
          <CardDescription>
            Onde seus ativos ficam guardados — corretoras tradicionais ou carteiras próprias (self-custody).
            Usado nos lançamentos e nas transferências internas de cripto.
          </CardDescription>
        </div>
        {!showForm && (
          <Button size="sm" onClick={() => setShowForm(true)}>
            <Plus className="mr-2 h-4 w-4" /> Nova
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {showForm && (
          <div className="rounded-lg border border-border p-4 space-y-3 bg-muted/20">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground">Nome</label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder='Ex: "Ledger", "MetaMask", "XP Investimentos"'
                  autoFocus
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground">Tipo</label>
                <Select value={type} onValueChange={setType}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(BROKER_TYPE_LABEL).map(([v, label]) => (
                      <SelectItem key={v} value={v}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">Cor</label>
              <div className="flex gap-2 flex-wrap">
                {DEFAULT_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setColor(c)}
                    className={`h-7 w-7 rounded-full transition-transform ${color === c ? "ring-2 ring-offset-2 ring-offset-background ring-primary scale-110" : ""}`}
                    style={{ background: c }}
                  />
                ))}
              </div>
            </div>
            <div className="flex items-center gap-2 pt-1">
              <Button size="sm" onClick={handleSubmit} disabled={saving}>
                {saving ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : null}
                {editingId ? "Salvar alterações" : "Adicionar"}
              </Button>
              <Button size="sm" variant="ghost" onClick={resetForm}>
                <X className="mr-1 h-3.5 w-3.5" /> Cancelar
              </Button>
            </div>
          </div>
        )}

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Carregando…</p>
        ) : brokers.length === 0 ? (
          <p className="text-sm text-muted-foreground py-2">
            Nenhuma corretora ou wallet cadastrada ainda.
          </p>
        ) : (
          <div className="space-y-1.5">
            {(brokers as any[]).map((b) => (
              <div key={b.id} className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="h-3 w-3 rounded-full shrink-0" style={{ background: b.color }} />
                  {b.type === "wallet" ? <Wallet className="h-3.5 w-3.5 text-muted-foreground shrink-0" /> : <Landmark className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
                  <span className="font-medium text-sm truncate">{b.name}</span>
                  <span className="text-xs text-muted-foreground shrink-0">{BROKER_TYPE_LABEL[b.type] ?? b.type}</span>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => startEdit(b)}>
                    <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setToDelete({ id: b.id, name: b.name })}>
                    <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>

      <AlertDialog open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover "{toDelete?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              Só é possível remover se não houver lançamentos associados a essa corretora/wallet.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>Remover</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
