import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, MessageCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Header } from "@/components/Header";
import { useAuth } from "@/lib/auth";
import { getMetadataPhone, saveProfileIdentity } from "@/lib/profile-completion";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/profile")({
  component: ProfilePage,
});

const WHATSAPP_GROUP_URL = import.meta.env.VITE_WHATSAPP_GROUP_URL?.trim() ?? "";

function ProfilePage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  useEffect(() => {
    if (!loading && !user) navigate({ to: "/auth" });
  }, [user, loading, navigate]);

  const qc = useQueryClient();
  const { data: profile } = useQuery({
    queryKey: ["profile", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", user!.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  useEffect(() => {
    if (profile) {
      setName(profile.display_name);
    }
    if (user) {
      setPhone(getMetadataPhone(user.user_metadata));
    }
  }, [profile, user]);

  const save = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("Sessão não encontrada");
      await saveProfileIdentity(user, name, phone);
    },
    onSuccess: () => {
      toast.success("Perfil atualizado");
      qc.invalidateQueries({ queryKey: ["profile"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const changePw = useMutation({
    mutationFn: async () => {
      if (newPw.length < 6) throw new Error("A senha deve ter pelo menos 6 caracteres");
      if (newPw !== confirmPw) throw new Error("As senhas não conferem");
      const { error } = await supabase.auth.updateUser({ password: newPw });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Senha alterada com sucesso");
      setNewPw("");
      setConfirmPw("");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="min-h-screen stadium-bg">
      <Header />
      <main className="mx-auto max-w-md px-4 py-10 space-y-6">
        <h1 className="text-2xl font-black uppercase tracking-tight">Perfil</h1>
        <div className="rounded-xl border border-border bg-card p-6 space-y-4">
          <div>
            <Label>Email</Label>
            <Input value={user?.email ?? ""} disabled />
          </div>
          <div>
            <Label>Nome de exibição</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="profile-phone">Telefone</Label>
            <Input
              id="profile-phone"
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              autoComplete="tel"
              placeholder="(11) 99999-9999"
            />
          </div>
          <Button
            className="w-full"
            onClick={() => save.mutate()}
            disabled={save.isPending || !name.trim() || !phone.trim()}
          >
            Salvar
          </Button>
        </div>

        {WHATSAPP_GROUP_URL ? (
          <div className="rounded-xl border border-border bg-card p-6 space-y-4">
            <div className="flex items-center gap-2">
              <MessageCircle className="h-5 w-5 text-primary" />
              <h2 className="text-lg font-bold uppercase tracking-tight">WhatsApp do Bolão</h2>
            </div>
            <Button asChild className="w-full">
              <a href={WHATSAPP_GROUP_URL} target="_blank" rel="noreferrer">
                Entrar no grupo do WhatsApp
                <ExternalLink className="h-4 w-4" />
              </a>
            </Button>
          </div>
        ) : null}

        <div className="rounded-xl border border-border bg-card p-6 space-y-4">
          <h2 className="text-lg font-bold uppercase tracking-tight">Alterar senha</h2>
          <div>
            <Label htmlFor="new-pw">Nova senha</Label>
            <Input
              id="new-pw"
              type="password"
              value={newPw}
              onChange={(e) => setNewPw(e.target.value)}
              minLength={6}
            />
          </div>
          <div>
            <Label htmlFor="confirm-pw">Confirmar nova senha</Label>
            <Input
              id="confirm-pw"
              type="password"
              value={confirmPw}
              onChange={(e) => setConfirmPw(e.target.value)}
              minLength={6}
            />
          </div>
          <Button
            className="w-full"
            variant="outline"
            onClick={() => changePw.mutate()}
            disabled={changePw.isPending || !newPw || !confirmPw}
          >
            {changePw.isPending ? "Alterando..." : "Alterar senha"}
          </Button>
        </div>
      </main>
    </div>
  );
}
