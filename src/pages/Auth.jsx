// src/pages/Auth.jsx
import { useState, useRef, useEffect } from "react";

export default function Auth({ onLogin }) {
  const [mode, setMode] = useState("login"); // 'login' | 'signup'
  const [step, setStep] = useState("mobile"); // 'mobile' | 'code'
  const [mobile, setMobile] = useState("");
  const [name, setName] = useState("");
  const [code, setCode] = useState(["", "", "", "", "", ""]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [mobileFormatted, setMobileFormatted] = useState("");
  const codeRefs = useRef([]);

  useEffect(() => {
    codeRefs.current[0]?.focus();
  }, [step === "code"]);

  const formatMobile = (val) => {
    const digits = val.replace(/\D/g, "");
    if (digits.length <= 5) return digits;
    if (digits.length <= 10) return `${digits.slice(0, 5)} ${digits.slice(5)}`;
    return `${digits.slice(0, 5)} ${digits.slice(5, 10)}`;
  };

  const handleMobileChange = (e) => {
    const raw = e.target.value.replace(/\s/g, "");
    if (raw.length > 10) return;
    setMobile(raw);
    setMobileFormatted(formatMobile(raw));
    setError("");
  };

  const handleMobileSubmit = (e) => {
    e.preventDefault();
    if (mobile.length < 10) {
      setError("Enter your 10-digit mobile number");
      return;
    }
    setStep("code");
    setError("");
    setTimeout(() => codeRefs.current[0]?.focus(), 100);
  };

  const handleCodeInput = (idx, val) => {
    if (!/^\d*$/.test(val)) return;
    const newCode = [...code];
    newCode[idx] = val.slice(-1);
    setCode(newCode);
    setError("");
    if (val && idx < 5) codeRefs.current[idx + 1]?.focus();
    if (newCode.every((d) => d !== "") && idx === 5) {
      submitAuth(newCode.join(""));
    }
  };

  const handleCodeKeyDown = (idx, e) => {
    if (e.key === "Backspace" && !code[idx] && idx > 0) {
      codeRefs.current[idx - 1]?.focus();
    }
  };

  const handleCodePaste = (e) => {
    const pasted = e.clipboardData
      .getData("text")
      .replace(/\D/g, "")
      .slice(0, 6);
    if (pasted.length === 6) {
      const newCode = pasted.split("");
      setCode(newCode);
      codeRefs.current[5]?.focus();
      submitAuth(pasted);
    }
  };

  const submitAuth = async (codeStr) => {
    setLoading(true);
    setError("");
    try {
      const endpoint =
        mode === "signup" ? "/api/auth/signup" : "/api/auth/login";
      const body = { mobile: "+91" + mobile, code: codeStr };
      if (mode === "signup" && name) body.name = name;

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!data.ok) {
        setError(data.error || "Something went wrong");
        setCode(["", "", "", "", "", ""]);
        setTimeout(() => codeRefs.current[0]?.focus(), 50);
        return;
      }
      onLogin(data.user, data.settings);
    } catch (e) {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const resetToMobile = () => {
    setStep("mobile");
    setCode(["", "", "", "", "", ""]);
    setError("");
  };

  const switchMode = (m) => {
    setMode(m);
    setStep("mobile");
    setMobile("");
    setMobileFormatted("");
    setCode(["", "", "", "", "", ""]);
    setName("");
    setError("");
  };

  return (
    <div className="auth-shell">
      <div className="auth-bg">
        <div className="auth-bg-circle c1"></div>
        <div className="auth-bg-circle c2"></div>
      </div>

      <div className="auth-card">
        {/* Logo */}
        <div className="auth-logo">
          <div className="auth-logo-mark">✉</div>
          <div className="auth-logo-name">
            Mail<span>Mind</span>
          </div>
        </div>

        {step === "mobile" && (
          <>
            <div className="auth-heading">
              {mode === "login" ? "Welcome back" : "Create account"}
            </div>
            <div className="auth-subheading">
              {mode === "login"
                ? "Enter your mobile number to continue"
                : "Enter your mobile number to get started"}
            </div>

            <form onSubmit={handleMobileSubmit} className="auth-form">
              {mode === "signup" && (
                <div className="auth-field">
                  <label className="auth-label">Your name (optional)</label>
                  <input
                    type="text"
                    className="auth-input"
                    placeholder="Rob Shuhy"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    autoComplete="name"
                  />
                </div>
              )}

              <div className="auth-field">
                <label className="auth-label">Mobile number</label>
                <div className="auth-phone-wrap">
                  <div className="auth-country-code">
                    <span className="flag">🇮🇳</span>
                    <span>+91</span>
                  </div>
                  <input
                    type="tel"
                    className="auth-input auth-phone-input"
                    placeholder="98765 43210"
                    value={mobileFormatted}
                    onChange={handleMobileChange}
                    autoComplete="tel"
                    inputMode="numeric"
                    autoFocus
                  />
                </div>
              </div>

              {error && <div className="auth-error">{error}</div>}

              <button
                type="submit"
                className="auth-btn"
                disabled={loading || mobile.length < 10}
              >
                Continue →
              </button>
            </form>

            <div className="auth-switch">
              {mode === "login" ? (
                <>
                  Don't have an account?{" "}
                  <button
                    className="auth-switch-btn"
                    onClick={() => switchMode("signup")}
                  >
                    Sign up
                  </button>
                </>
              ) : (
                <>
                  Already have an account?{" "}
                  <button
                    className="auth-switch-btn"
                    onClick={() => switchMode("login")}
                  >
                    Log in
                  </button>
                </>
              )}
            </div>
          </>
        )}

        {step === "code" && (
          <>
            <div className="auth-heading">Enter your secret code</div>
            <div className="auth-subheading">
              Enter the 6-digit secret code{" "}
              {mode === "signup"
                ? "you want to set"
                : "you set when signing up"}
            </div>

            <div className="auth-mobile-display" onClick={resetToMobile}>
              <span>🇮🇳 +91 {mobileFormatted}</span>
              <span className="auth-change">Change</span>
            </div>

            {mode === "signup" && (
              <div className="auth-code-hint">
                💡 Choose any 6 digits you'll remember — this is your permanent
                password
              </div>
            )}

            <div className="auth-code-wrap" onPaste={handleCodePaste}>
              {code.map((digit, idx) => (
                <input
                  key={idx}
                  ref={(el) => (codeRefs.current[idx] = el)}
                  type="password"
                  inputMode="numeric"
                  maxLength={1}
                  className={`auth-code-box${digit ? " filled" : ""}`}
                  value={digit}
                  onChange={(e) => handleCodeInput(idx, e.target.value)}
                  onKeyDown={(e) => handleCodeKeyDown(idx, e)}
                  disabled={loading}
                  autoComplete="off"
                />
              ))}
            </div>

            {loading && (
              <div className="auth-loading">
                <div className="auth-spin"></div>
                <span>
                  {mode === "signup"
                    ? "Creating your account…"
                    : "Logging you in…"}
                </span>
              </div>
            )}

            {error && <div className="auth-error">{error}</div>}

            <button
              className="auth-back"
              onClick={resetToMobile}
              disabled={loading}
            >
              ← Back
            </button>
          </>
        )}

        <div className="auth-footer">
          Your data is encrypted · No passwords stored ·{" "}
          <span style={{ color: "var(--accent-mid)" }}>Private by design</span>
        </div>
      </div>
    </div>
  );
}
