import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Link2, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";

type ExternalLinkRow = {
  id: string;
  user_id: string;
  slot: number;
  name: string;
  url: string;
  username: string | null;
  created_at: string;
};

type ExternalLinksSidebarProps = {
  compact: boolean;
  expanded: boolean;
  onNavigate?: () => void;
};

const slots = [1, 2, 3] as const;
const queryKey = ["external-links"] as const;

function normalizeExternalUrl(value: string): string | null {
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export function ExternalLinksSidebar({ compact, expanded, onNavigate }: ExternalLinksSidebarProps) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const showLabels = !compact || expanded;
  const [dialogSlot, setDialogSlot] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [username, setUsername] = useState("");

  const linksQuery = useQuery({
    queryKey: [...queryKey, user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("external_links")
        .select("id, user_id, slot, name, url, username, created_at")
        .eq("user_id", user!.id)
        .order("slot");
      if (error) throw error;
      return (data ?? []) as ExternalLinkRow[];
    },
    staleTime: 60_000,
  });

  const saveMutation = useMutation({
    mutationFn: async (values: { slot: number; name: string; url: string; username: string }) => {
      if (!user) throw new Error("Sua sessão expirou. Entre novamente.");
      const safeUrl = normalizeExternalUrl(values.url);
      if (!safeUrl) throw new Error("Informe um endereço válido iniciado por http:// ou https://.");

      const { error } = await supabase.from("external_links").upsert({
        user_id: user.id,
        slot: values.slot,
        name: values.name.trim(),
        url: safeUrl,
        username: values.username.trim() || null,
      }, { onConflict: "user_id,slot" });
      if (error) throw error;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: [...queryKey, user?.id] });
      closeDialog();
      toast.success("Link salvo na sidebar.");
    },
    onError: (error) => toast.error(error.message || "Não foi possível salvar o link."),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("external_links").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: [...queryKey, user?.id] });
      toast.success("Link removido da sidebar.");
    },
    onError: (error) => toast.error(error.message || "Não foi possível remover o link."),
  });

  function closeDialog() {
    setDialogSlot(null);
    setName("");
    setUrl("");
    setUsername("");
  }

  function openDialog(slot: number, link?: ExternalLinkRow) {
    setDialogSlot(slot);
    setName(link?.name ?? "");
    setUrl(link?.url ?? "");
    setUsername(link?.username ?? "");
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!dialogSlot) return;
    if (!name.trim()) {
      toast.error("Informe o nome do serviço.");
      return;
    }
    saveMutation.mutate({ slot: dialogSlot, name, url, username });
  }

  const links = linksQuery.data ?? [];

  return (
    <>
      <div className={compact && !expanded ? "my-1 h-px w-7 self-center bg-sidebar-border" : "my-2 h-px w-full bg-sidebar-border"} />
      {showLabels && (
        <p className={compact ? "px-3 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-wider text-sidebar-foreground/45" : "px-3 pb-1 pt-1 text-xs font-semibold uppercase tracking-wider text-sidebar-foreground/45"}>
          Links externos
        </p>
      )}
      <div className={`flex flex-col gap-1.5 ${compact ? (expanded ? "w-full px-3" : "items-center") : "w-full px-3"}`}>
        {slots.map((slot) => {
          const link = links.find((item) => item.slot === slot);
          return (
            <div key={slot} className={`flex items-center gap-1 ${compact && !expanded ? "w-11 justify-center" : "w-full"}`}>
              <Button
                type="button"
                variant="ghost"
                className={`group/link h-10 min-w-0 flex-1 justify-start rounded-xl px-3 text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground ${compact && !expanded ? "w-11 flex-none justify-center px-0" : "gap-3"}`}
                title={link ? `${link.name} — abrir link` : `Adicionar link externo ${slot}`}
                aria-label={link ? `Abrir ${link.name}` : `Adicionar link externo ${slot}`}
                onClick={() => {
                  if (!link) {
                    openDialog(slot);
                    return;
                  }
                  window.open(link.url, "_blank", "noopener,noreferrer");
                  onNavigate?.();
                }}
              >
                {link ? <ExternalLink className="h-[18px] w-[18px] shrink-0" /> : <Plus className="h-[18px] w-[18px] shrink-0" />}
                {showLabels && <span className="min-w-0 flex-1 truncate text-left">{link?.name ?? `Adicionar link ${slot}`}</span>}
                {showLabels && link && <span className="sr-only">Abrir em nova aba</span>}
              </Button>
              {showLabels && link && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-sidebar-foreground/50" aria-label={`Opções de ${link.name}`}>
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" side="right">
                    <DropdownMenuItem onSelect={() => openDialog(slot, link)}>
                      <Pencil className="mr-2 h-4 w-4" /> Editar
                    </DropdownMenuItem>
                    <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => deleteMutation.mutate(link.id)}>
                      <Trash2 className="mr-2 h-4 w-4" /> Remover
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          );
        })}
      </div>

      <Dialog open={dialogSlot !== null} onOpenChange={(open) => !open && closeDialog()}>
        <DialogContent>
          <form onSubmit={submit} className="space-y-5">
            <DialogHeader>
              <DialogTitle>{links.some((link) => link.slot === dialogSlot) ? "Editar link externo" : "Adicionar link externo"}</DialogTitle>
              <DialogDescription>Configure um atalho para acessar outro serviço pela sidebar.</DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="external-link-name">Nome do serviço</Label>
                <Input id="external-link-name" autoFocus maxLength={40} placeholder="Ex.: Corretora" value={name} onChange={(event) => setName(event.target.value)} required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="external-link-url">URL</Label>
                <Input id="external-link-url" type="url" placeholder="https://exemplo.com" value={url} onChange={(event) => setUrl(event.target.value)} required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="external-link-username">Usuário ou e-mail (opcional)</Label>
                <Input id="external-link-username" autoComplete="username" maxLength={254} placeholder="Login usado no serviço" value={username} onChange={(event) => setUsername(event.target.value)} />
              </div>
              <p className="flex gap-2 rounded-md bg-muted p-3 text-xs text-muted-foreground">
                <Link2 className="mt-0.5 h-4 w-4 shrink-0" />
                O Folio não armazena senhas. Salve a senha no gerenciador do navegador para o site de destino.
              </p>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={closeDialog}>Cancelar</Button>
              <Button type="submit" disabled={saveMutation.isPending}>{saveMutation.isPending ? "Salvando…" : "Salvar link"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

