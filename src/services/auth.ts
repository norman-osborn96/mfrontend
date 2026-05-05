import { createClient, type Session, SupabaseClient, type User } from "@supabase/supabase-js";

const BASE_URL = import.meta.env.VITE_API_URL || "https://mbackend-eq1g.onrender.com";
const FETCH_TIMEOUT_MS = 12_000;
const SUPABASE_GET_USER_MS = 8_000;

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** Omit when `.env` has no Supabase keys (Google-session-only setups). */
export const supabase: SupabaseClient | null =
    supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null;

async function fetchWithCredentials(
    url: string,
    ms = FETCH_TIMEOUT_MS,
    init: Omit<RequestInit, "credentials" | "signal"> = {}
): Promise<Response> {
    const ctrl = new AbortController();
    const tid = window.setTimeout(() => ctrl.abort(), ms);
    try {
        return await fetch(url, {
            ...init,
            credentials: "include",
            signal: ctrl.signal,
        });
    } finally {
        window.clearTimeout(tid);
    }
}

export interface UserProfile {
    id: string;
    email: string;
    name?: string;
    given_name?: string;
    picture?: string;
    provider: "google" | "supabase";
}

export function profileFromSupabaseUser(u: User): UserProfile {
    return {
        id: u.id,
        email: u.email ?? "",
        name: u.user_metadata?.full_name ?? u.user_metadata?.name,
        given_name: u.user_metadata?.given_name,
        picture: u.user_metadata?.avatar_url,
        provider: "supabase",
    };
}

/**
 * Gmail session stored in backend cookies — does not use Supabase Auth.
 * Used alone and from `onAuthStateChange` when Supabase has no session.
 */
export async function getBackendGoogleUser(): Promise<UserProfile | null> {
    try {
        const statusRes = await fetchWithCredentials(`${BASE_URL}/api/auth/status`);
        if (!statusRes.ok) return null;
        const { authenticated } = await statusRes.json();
        if (!authenticated) return null;
        try {
            const meRes = await fetchWithCredentials(`${BASE_URL}/api/auth/me`);
            if (meRes.ok) {
                const profile = await meRes.json();
                return {
                    id: profile.email,
                    email: profile.email,
                    name: profile.name,
                    given_name: profile.given_name,
                    picture: profile.picture,
                    provider: "google",
                };
            }
        } catch {
            /* `/me` slow or aborted — session still flags logged in */
        }
        return { id: "google-oauth-user", email: "", provider: "google" };
    } catch {
        return null;
    }
}

async function getSupabaseUserProfile(): Promise<UserProfile | null> {
    if (!supabase) return null;
    const getUserPromise = supabase.auth.getUser();
    const timeout = new Promise<never>((_, reject) =>
        window.setTimeout(() => reject(new Error("supabase.auth.getUser() timeout")), SUPABASE_GET_USER_MS)
    );
    try {
        const { data, error } = await Promise.race([getUserPromise, timeout]);
        if (error || !data.user) return null;
        return profileFromSupabaseUser(data.user);
    } catch {
        return null;
    }
}

// 🔐 SIGN UP
export const signUp = async (email: string, password: string) => {
    if (!supabase)
        return { data: { user: null }, error: new Error("Supabase is not configured (add VITE_SUPABASE_* env).") };
    return supabase.auth.signUp({ email, password });
};

// 🔐 LOGIN
export const login = async (email: string, password: string) => {
    if (!supabase)
        return { data: { user: null, session: null }, error: new Error("Supabase is not configured (add VITE_SUPABASE_* env).") };
    return supabase.auth.signInWithPassword({ email, password });
};

// 👤 GET USER — unified profile (backend Google OAuth first, then Supabase Auth)
export const getUser = async (): Promise<UserProfile | null> => {
    const google = await getBackendGoogleUser();
    if (google) return google;
    return await getSupabaseUserProfile();
};

/** Apply Supabase session changes without dropping a valid Google OAuth session. */
export function mergeAuthStateIntoProfile(session: Session | null): Promise<UserProfile | null> {
    if (session?.user) return Promise.resolve(profileFromSupabaseUser(session.user));
    return getBackendGoogleUser();
}

// 🔓 LOGOUT
export const logout = async () => {
    try {
        await fetchWithCredentials(`${BASE_URL}/api/auth/logout`, FETCH_TIMEOUT_MS, { method: "POST" });
    } catch (e) {
        console.error("Backend logout error", e);
    }
    if (!supabase) return;
    await supabase.auth.signOut();
};
