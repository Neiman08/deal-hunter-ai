import React, { createContext, useContext, useState, useEffect } from 'react';
import api from '../utils/api';
import i18n from '../i18n';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    const saved = localStorage.getItem('dh_user');
    return saved ? JSON.parse(saved) : null;
  });
  const [loading, setLoading] = useState(false);

  function applyUserLanguage(userData) {
    if (userData?.preferred_language) {
      i18n.changeLanguage(userData.preferred_language);
      localStorage.setItem('dealhunter_language', userData.preferred_language);
    }
  }

  const login = async (email, password) => {
    const res = await api.post('/auth/login', { email, password });
    localStorage.setItem('dh_token', res.data.token);
    localStorage.setItem('dh_user', JSON.stringify(res.data.user));
    setUser(res.data.user);
    applyUserLanguage(res.data.user);
    return res.data;
  };

  const register = async (data) => {
    const res = await api.post('/auth/register', data);
    localStorage.setItem('dh_token', res.data.token);
    localStorage.setItem('dh_user', JSON.stringify(res.data.user));
    setUser(res.data.user);
    applyUserLanguage(res.data.user);
    return res.data;
  };

  const logout = () => {
    localStorage.removeItem('dh_token');
    localStorage.removeItem('dh_user');
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, login, register, logout, loading }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be inside AuthProvider');
  return ctx;
};
