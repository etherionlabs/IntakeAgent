import { Routes, Route } from 'react-router-dom';
import { AuthProvider } from './auth/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import Layout from './components/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route element={<ProtectedRoute />}>
          <Route element={<Layout />}>
            <Route path="/" element={<Dashboard />} />
            <Route path="/contacts" element={<div>Contactos</div>} />
            <Route path="/usage" element={<div>Uso</div>} />
            <Route path="/whatsapp" element={<div>WhatsApp</div>} />
          </Route>
        </Route>
      </Routes>
    </AuthProvider>
  );
}
