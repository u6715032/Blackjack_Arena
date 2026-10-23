import { createContext, useContext, useEffect, useState } from "react";
import { api } from "./api";

const AuthContext = createContext(null);
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    api("/auth/me")
      .then((data) => setUser(data.user))
      .catch((error) => {
        if (error.status !== 401) setError(error.message);
      })
      .finally(() => setLoading(false));
  }, []);
  async function authenticate(mode, values) {
    const data = await api(`/auth/${mode}`, { method: "POST", body: values });
    setUser(data.user);
    setError("");
  }
  async function logout() {
    await api("/auth/logout", { method: "POST" });
    setUser(null);
  }
  return (
    <AuthContext.Provider
      value={{ user, loading, error, authenticate, logout }}
    >
      {children}
    </AuthContext.Provider>
  );
}
export const useAuth = () => useContext(AuthContext);
