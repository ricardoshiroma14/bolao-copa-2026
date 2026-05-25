import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Trophy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/lib/auth";
import {
  getInitialDisplayName,
  getMetadataPhone,
  isProfileComplete,
  saveProfileIdentity,
} from "@/lib/profile-completion";
import { resolveUserPoolId } from "@/lib/redirect-to-pool";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/complete-profile")({
  component: CompleteProfilePage,
});

function CompleteProfilePage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [initializedUserId, setInitializedUserId] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [phone, setPhone] = useState("");

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/auth", replace: true });
  }, [loading, navigate, user]);

  const { data: profile, isLoading: profileLoading } = useQuery({
    queryKey: ["profile-completion", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("display_name")
        .eq("id", user!.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const goToPool = async (uid: string) => {
    const poolId = await resolveUserPoolId(uid);
    if (poolId) navigate({ to: "/pool/$id", params: { id: poolId }, replace: true });
    else navigate({ to: "/dashboard", replace: true });
  };

  useEffect(() => {
    if (!user || profileLoading || initializedUserId === user.id) return;
    setDisplayName(getInitialDisplayName(user, profile ?? null));
    setPhone(getMetadataPhone(user.user_metadata));
    setInitializedUserId(user.id);
  }, [initializedUserId, profile, profileLoading, user]);

  useEffect(() => {
    if (!user || profileLoading || initializedUserId !== user.id) return;
    if (isProfileComplete(user, profile ?? null)) void goToPool(user.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initializedUserId, profile, profileLoading, user]);

  const save = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("Sessão não encontrada");
      await saveProfileIdentity(user, displayName, phone);
    },
    onSuccess: async () => {
      toast.success("Perfil completo");
      await qc.invalidateQueries({ queryKey: ["profile-completion"] });
      await qc.invalidateQueries({ queryKey: ["profile"] });
      if (user) await goToPool(user.id);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="min-h-screen stadium-bg flex items-center justify-center p-4">
      <main className="w-full max-w-md">
        <Link to="/" className="mb-8 flex items-center justify-center gap-2">
          <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Trophy className="h-5 w-5" />
          </div>
          <div className="text-lg font-bold uppercase tracking-wider">Bolão da Copa</div>
        </Link>

        <form
          className="rounded-2xl border border-border bg-card p-6 shadow-2xl space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <h1 className="text-2xl font-black uppercase tracking-tight">Complete seu perfil</h1>
          <div>
            <Label htmlFor="complete-display-name">Nome de exibição</Label>
            <Input
              id="complete-display-name"
              required
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              autoComplete="name"
            />
          </div>
          <div>
            <Label htmlFor="complete-phone">Telefone</Label>
            <Input
              id="complete-phone"
              type="tel"
              required
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              autoComplete="tel"
              placeholder="(11) 99999-9999"
            />
          </div>
          <Button
            type="submit"
            className="w-full font-bold uppercase"
            disabled={save.isPending || !displayName.trim() || !phone.trim()}
          >
            {save.isPending ? "Salvando..." : "Continuar para o bolão"}
          </Button>
        </form>
      </main>
    </div>
  );
}
