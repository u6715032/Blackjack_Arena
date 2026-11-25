import { createContext, useContext, useEffect, useState } from "react";
import { api } from "./api";

const AuthContext = createContext(null);
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reward, setReward] = useState(null);
  function acceptSession(data) {
    setUser(data.user);
    setReward({
      granted: Boolean(data.rewardGranted),
      nextRewardAt: data.nextRewardAt || null,
    });
  }
  useEffect(() => {
    api("/auth/me")
      .then(acceptSession)
      .catch((error) => {
        if (error.status !== 401) setError(error.message);
      })
      .finally(() => setLoading(false));
  }, []);
  async function authenticate(mode, values) {
    const data = await api(`/auth/${mode}`, { method: "POST", body: values });
    acceptSession(data);
    setError("");
  }
  async function logout() {
    await api("/auth/logout", { method: "POST" });
    setUser(null);
    setReward(null);
  }
  async function refreshBalance() {
    const { chips } = await api("/wallet");
    setUser((current) => (current ? { ...current, chips } : current));
  }
  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        error,
        reward,
        authenticate,
        logout,
        refreshBalance,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
export const useAuth = () => useContext(AuthContext);
