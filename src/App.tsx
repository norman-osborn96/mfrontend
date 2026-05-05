import { BrowserRouter as Router, Routes, Route, Navigate } from "react-router-dom";
import { useEffect, useState } from "react";

import Dashboard from "./pages/Dashboard";
import AdminDashboard from "./pages/AdminDashboard";
import Login from "./pages/Login";

import { getUser, mergeAuthStateIntoProfile, supabase, type UserProfile } from "./services/auth";

function App() {
    const [user, setUser] = useState<UserProfile | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let cancelled = false;

        const loadUser = async () => {
            try {
                const u = await getUser();
                if (!cancelled) setUser(u);
            } finally {
                if (!cancelled) setLoading(false);
            }
        };

        void loadUser();

        if (!supabase) {
            return () => {
                cancelled = true;
            };
        }

        const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
            void (async () => {
                try {
                    const u = await mergeAuthStateIntoProfile(session);
                    if (!cancelled) setUser(u);
                } catch {
                    if (!cancelled) setUser(null);
                }
            })();
        });

        return () => {
            cancelled = true;
            listener.subscription.unsubscribe();
        };
    }, []);

    if (loading) {
        return <div className="br-app-loading">Loading…</div>;
    }

    return (
        <Router>
            <Routes>
                <Route path="/login" element={user ? <Navigate to="/" /> : <Login />} />

                <Route path="/" element={user ? <Dashboard /> : <Navigate to="/login" />} />

                <Route path="/admin" element={user ? <AdminDashboard /> : <Navigate to="/login" />} />
            </Routes>
        </Router>
    );
}

export default App;
