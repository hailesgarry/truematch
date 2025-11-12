import React, { useState } from "react";
import { useAuthStore } from "../stores/authStore";
import { useNavigate, Navigate } from "react-router-dom";

const LoginPage: React.FC = () => {
  const { login, joined, loading, error } = useAuthStore();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const navigate = useNavigate();
  if (joined) return <Navigate to="/" replace />;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    await login(username.trim(), password);
    if (!error) navigate("/");
  };
  return (
    <div className="max-w-sm mx-auto p-6">
      <h1 className="text-xl font-semibold mb-4">Log in</h1>
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium mb-1">Username</label>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="w-full border rounded px-3 py-2 text-sm"
            autoComplete="username"
            required
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Password</label>
          <input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            type="password"
            className="w-full border rounded px-3 py-2 text-sm"
            autoComplete="current-password"
            required
          />
        </div>
        {error && (
          <div className="text-xs text-red-600" role="alert">
            {error}
          </div>
        )}
        <button
          type="submit"
          disabled={loading}
          className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded py-2 text-sm font-medium"
        >
          {loading ? "Logging in…" : "Log in"}
        </button>
        <div className="text-center text-xs text-gray-600">
          Need an account?{" "}
          <a className="text-blue-600" href="/signup">
            Sign up
          </a>
        </div>
      </form>
    </div>
  );
};
export default LoginPage;
