"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";

import { EMPTY_STORE, mergeProgress, ProgressStore } from "@/lib/study";
import { getSupabaseClient, isSupabaseConfigured } from "@/lib/supabase";

export type CloudStatus = "local" | "connecting" | "syncing" | "synced" | "offline" | "error";

export function useCloudProgress(
  hydrated: boolean,
  progress: ProgressStore,
  setProgress: React.Dispatch<React.SetStateAction<ProgressStore>>,
) {
  const [user, setUser] = useState<User | null>(null);
  const [status, setStatus] = useState<CloudStatus>("local");
  const [message, setMessage] = useState("");
  const [lastSyncedAt, setLastSyncedAt] = useState<string>();
  const [syncRequest, setSyncRequest] = useState(0);
  const progressRef = useRef(progress);
  const userRef = useRef<User | null>(null);
  const syncingRef = useRef(false);
  const pendingRef = useRef(false);

  useEffect(() => {
    progressRef.current = progress;
  }, [progress]);

  const syncNow = useCallback(async () => {
    const client = getSupabaseClient();
    const currentUser = userRef.current;
    if (!client || !currentUser || !hydrated) return;
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      setStatus("offline");
      return;
    }
    if (syncingRef.current) {
      pendingRef.current = true;
      return;
    }

    syncingRef.current = true;
    setStatus("syncing");
    setMessage("");
    try {
      const { data, error: readError } = await client
        .from("user_progress")
        .select("progress, updated_at")
        .eq("user_id", currentUser.id)
        .maybeSingle();
      if (readError) throw readError;

      const merged = data?.progress
        ? mergeProgress(progressRef.current, data.progress)
        : mergeProgress(progressRef.current, EMPTY_STORE);
      const { error: writeError } = await client.from("user_progress").upsert({
        user_id: currentUser.id,
        progress: merged,
        updated_at: new Date().toISOString(),
      });
      if (writeError) throw writeError;

      progressRef.current = merged;
      setProgress((current) =>
        JSON.stringify(current) === JSON.stringify(merged) ? current : merged,
      );
      setLastSyncedAt(new Date().toISOString());
      setStatus("synced");
    } catch (error) {
      const detail = error instanceof Error ? error.message : "클라우드 저장에 실패했습니다.";
      setMessage(
        detail.includes("user_progress")
          ? "Supabase에 학습 기록 표가 아직 만들어지지 않았습니다."
          : detail,
      );
      setStatus("error");
    } finally {
      syncingRef.current = false;
      if (pendingRef.current) {
        pendingRef.current = false;
        setSyncRequest((value) => value + 1);
      }
    }
  }, [hydrated, setProgress]);

  useEffect(() => {
    const client = getSupabaseClient();
    if (!client) return;
    let active = true;

    void client.auth.getSession().then(({ data }) => {
      if (!active) return;
      const nextUser = data.session?.user ?? null;
      userRef.current = nextUser;
      setUser(nextUser);
      setStatus(nextUser ? "connecting" : "local");
      if (nextUser) window.setTimeout(() => void syncNow(), 0);
    });

    const { data: listener } = client.auth.onAuthStateChange((_event, session) => {
      const nextUser = session?.user ?? null;
      userRef.current = nextUser;
      setUser(nextUser);
      setMessage("");
      setStatus(nextUser ? "connecting" : "local");
      if (nextUser) window.setTimeout(() => void syncNow(), 0);
    });

    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, [syncNow]);

  useEffect(() => {
    if (!hydrated || !user) return;
    const timer = window.setTimeout(() => void syncNow(), 1400);
    return () => window.clearTimeout(timer);
  }, [hydrated, progress, syncNow, syncRequest, user]);

  useEffect(() => {
    function handleOnline() {
      if (userRef.current) void syncNow();
    }
    function handleOffline() {
      if (userRef.current) setStatus("offline");
    }
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [syncNow]);

  async function signInWithGoogle() {
    const client = getSupabaseClient();
    if (!client) return false;
    setStatus("connecting");
    setMessage("");
    const redirectTo = `${window.location.origin}${window.location.pathname}`;
    const { error } = await client.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo },
    });
    if (error) {
      setStatus("error");
      setMessage(error.message);
      return false;
    }
    return true;
  }

  async function signOut() {
    const client = getSupabaseClient();
    if (!client) return;
    await client.auth.signOut();
    userRef.current = null;
    setUser(null);
    setStatus("local");
    setMessage("로그아웃했습니다. 합쳐진 기록은 이 기기에도 남아 있습니다.");
  }

  async function clearRemote() {
    const client = getSupabaseClient();
    const currentUser = userRef.current;
    if (!client || !currentUser) return true;
    const { error } = await client.from("user_progress").delete().eq("user_id", currentUser.id);
    if (error) {
      setStatus("error");
      setMessage(error.message);
      return false;
    }
    progressRef.current = structuredClone(EMPTY_STORE);
    setLastSyncedAt(undefined);
    return true;
  }

  return {
    configured: isSupabaseConfigured(),
    user,
    status,
    message,
    lastSyncedAt,
    signInWithGoogle,
    signOut,
    syncNow,
    clearRemote,
  };
}

