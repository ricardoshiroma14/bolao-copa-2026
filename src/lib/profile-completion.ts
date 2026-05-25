import type { User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export type ProfileIdentity = {
  display_name: string | null;
} | null;

function metadataString(metadata: Record<string, unknown> | undefined, key: string) {
  const value = metadata?.[key];
  return typeof value === "string" ? value.trim() : "";
}

export function getMetadataPhone(metadata: Record<string, unknown> | undefined) {
  return metadataString(metadata, "phone");
}

export function getMetadataDisplayName(metadata: Record<string, unknown> | undefined) {
  return (
    metadataString(metadata, "display_name") ||
    metadataString(metadata, "full_name") ||
    metadataString(metadata, "name")
  );
}

export function getInitialDisplayName(user: User, profile: ProfileIdentity) {
  return (
    profile?.display_name?.trim() ||
    getMetadataDisplayName(user.user_metadata) ||
    user.email?.split("@")[0]?.trim() ||
    ""
  );
}

export function isProfileComplete(user: User, profile: ProfileIdentity) {
  return Boolean(getInitialDisplayName(user, profile) && getMetadataPhone(user.user_metadata));
}

export async function saveProfileIdentity(user: User, displayName: string, phone: string) {
  const trimmedName = displayName.trim();
  const trimmedPhone = phone.trim();
  if (!trimmedName) throw new Error("Informe seu nome de exibição");
  if (!trimmedPhone) throw new Error("Informe seu telefone");

  const { error: profileError } = await supabase
    .from("profiles")
    .upsert({ id: user.id, display_name: trimmedName }, { onConflict: "id" });
  if (profileError) throw profileError;

  const { error: authError } = await supabase.auth.updateUser({
    data: { ...user.user_metadata, display_name: trimmedName, phone: trimmedPhone },
  });
  if (authError) throw authError;
}
