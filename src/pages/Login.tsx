import { useState } from "react";
import { login, signUp } from "../services/auth";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSignup, setIsSignup] = useState(false);
  const [error, setError] = useState("");
  const [successMessage, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    setError("");
    setSuccess("");
    setLoading(true);
    const fn = isSignup ? signUp : login;
    const { error } = await fn(email, password);
    setLoading(false);
    if (error) {
      setError(error.message);
      return;
    }
    if (isSignup) {
      setSuccess("Check your email to confirm your account before logging in.");
      return;
    }
    window.location.reload();
  };

  return (
    <div className="br-login-page">
      <div className="br-login-aside">
        <p style={{ fontSize: 12, letterSpacing: "0.12em", textTransform: "uppercase", opacity: 0.7, marginBottom: 12 }}>MailPulse</p>
        <h1>Your inbox, one calm screen.</h1>
        <p>AI-ranked priority, real Gmail sync, and a dashboard inspired by the way exec teams run their day.</p>
      </div>
      <div className="br-login-form-wrap">
        <div className="br-login-card">
          <h2>{isSignup ? "Create account" : "Welcome back"}</h2>
          <p className="br-login-sub">{isSignup ? "Start with MailPulse." : "Sign in to continue to MailPulse."}</p>

          <label className="br-form-label" htmlFor="br-email">
            Email address
          </label>
          <input
            id="br-email"
            className="br-input"
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
          />

          <label className="br-form-label" htmlFor="br-pw">
            Password
          </label>
          <input
            id="br-pw"
            className="br-input"
            type="password"
            autoComplete="current-password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
          />

          <button type="button" className="br-btn-primary" onClick={handleSubmit} disabled={loading}>
            {loading ? "Please wait…" : isSignup ? "Create account" : "Sign in"}
          </button>

          <div className="br-login-divider">or</div>

          <button type="button" className="br-google" onClick={() => (window.location.href = "https://mbackend-eq1g.onrender.com/api/auth/login")}>
            <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden>
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
            </svg>
            Continue with Google
          </button>

          <p className="br-login-foot">
            {isSignup ? "Already have an account? " : "No account? "}
            <button
              type="button"
              onClick={() => {
                setIsSignup(!isSignup);
                setError("");
                setSuccess("");
              }}
            >
              {isSignup ? "Sign in" : "Sign up"}
            </button>
          </p>

          {error && <div className="br-msg-err">{error}</div>}
          {successMessage && <div className="br-msg-ok">{successMessage}</div>}
        </div>
      </div>
    </div>
  );
}
