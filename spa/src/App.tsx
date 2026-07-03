import { Routes, Route } from 'react-router-dom';
import { AuthProvider } from './auth/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import Layout from './components/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import JobDetail from './pages/JobDetail';
import Contacts from './pages/Contacts';
import Usage from './pages/Usage';
import WhatsApp from './pages/WhatsApp';
import Settings from './pages/Settings';
import Billing from './pages/Billing';
import Signup from './pages/Signup';
import VerifyEmail from './pages/VerifyEmail';
import Onboarding from './pages/Onboarding';
import Admin from './pages/Admin';
import Landing from './pages/Landing';
import Legal from './pages/Legal';

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<Signup />} />
        <Route path="/verify-email" element={<VerifyEmail />} />
        <Route path="/landing" element={<Landing />} />
        <Route path="/terms" element={<Legal doc="terms" />} />
        <Route path="/privacy" element={<Legal doc="privacy" />} />
        <Route path="/dpa" element={<Legal doc="dpa" />} />
        <Route path="/whatsapp-policy" element={<Legal doc="whatsapp_policy" />} />
        <Route element={<ProtectedRoute />}>
          <Route path="/onboarding" element={<Onboarding />} />
          <Route element={<Layout />}>
            <Route path="/" element={<Dashboard />} />
            <Route path="/jobs/:id" element={<JobDetail />} />
            <Route path="/contacts" element={<Contacts />} />
            <Route path="/usage" element={<Usage />} />
            <Route path="/whatsapp" element={<WhatsApp />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/billing" element={<Billing />} />
            <Route path="/admin" element={<Admin />} />
          </Route>
        </Route>
      </Routes>
    </AuthProvider>
  );
}
