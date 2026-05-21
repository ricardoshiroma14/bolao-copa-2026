import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Header } from "@/components/Header";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/profile")({
  component: ProfilePage,
});

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
  useEffect(() => {
    if (profile) setName(profile.display_name);
  }, [profile]);

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("profiles")
        .update({ display_name: name })
        .eq("id", user!.id);
      if (error) throw error;
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
          <Button
            className="w-full"
            onClick={() => save.mutate()}
            disabled={save.isPending || !name}
          >
            Salvar
          </Button>
        </div>

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
