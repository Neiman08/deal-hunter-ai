import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import Search from './pages/Search';
import DealDetail from './pages/DealDetail';
import MapView from './pages/MapView';
import Scanner from './pages/Scanner';
import Alerts from './pages/Alerts';
import Admin from './pages/Admin';
import Pricing from './pages/Pricing';
import Login from './pages/Login';
import Recommendations from './pages/Recommendations';
import Watchlist from './pages/Watchlist';
import ProHunter from './pages/ProHunter';
import Analytics from './pages/Analytics';
import Referrals from './pages/Referrals';
import Feed from './pages/Feed';
import CollaboratorDashboard from './pages/CollaboratorDashboard';
import CollaboratorSubmit from './pages/CollaboratorSubmit';
import CollaboratorSubmissions from './pages/CollaboratorSubmissions';
import CollaboratorLeaderboard from './pages/CollaboratorLeaderboard';
import Teams from './pages/Teams';
import TeamDetail from './pages/TeamDetail';
import AdminSubmittedDeals from './pages/AdminSubmittedDeals';
import Community from './pages/Community';
import BusinessHome from './pages/BusinessHome';
import University from './pages/University';
import AICoach from './pages/AICoach';
import HallOfFame from './pages/HallOfFame';
import Notifications from './pages/Notifications';
import TeamCRM from './pages/TeamCRM';
import BusinessStats from './pages/BusinessStats';

function PrivateRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return (
    <div className="flex items-center justify-center h-screen bg-dark-900">
      <div className="w-8 h-8 border-2 border-neon-green border-t-transparent rounded-full animate-spin" />
    </div>
  );
  return user ? children : <Navigate to="/login" replace />;
}

function AdminRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return null;
  return user?.is_admin ? children : <Navigate to="/" replace />;
}

export default function App() {
  return (
    <AuthProvider>
      <HashRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/" element={<PrivateRoute><Layout /></PrivateRoute>}>
            <Route index element={<Dashboard />} />
            <Route path="search" element={<Search />} />
            <Route path="deal/:id" element={<DealDetail />} />
            <Route path="map" element={<MapView />} />
            <Route path="scanner" element={<Scanner />} />
            <Route path="alerts" element={<Alerts />} />
            <Route path="watchlist" element={<Watchlist />} />
            <Route path="recommendations" element={<Recommendations />} />
            <Route path="pro-hunter" element={<ProHunter />} />
            <Route path="analytics" element={<Analytics />} />
            <Route path="referrals" element={<Referrals />} />
            <Route path="pricing" element={<Pricing />} />
            <Route path="feed" element={<Feed />} />
            <Route path="collaborator" element={<CollaboratorDashboard />} />
            <Route path="collaborator/submit" element={<CollaboratorSubmit />} />
            <Route path="collaborator/submissions" element={<CollaboratorSubmissions />} />
            <Route path="collaborator/leaderboard" element={<CollaboratorLeaderboard />} />
            <Route path="community" element={<Community />} />
            <Route path="teams" element={<Teams />} />
            <Route path="teams/:id" element={<TeamDetail />} />
            <Route path="admin" element={<AdminRoute><Admin /></AdminRoute>} />
            <Route path="business" element={<BusinessHome />} />
            <Route path="business/university" element={<University />} />
            <Route path="business/coach" element={<AICoach />} />
            <Route path="business/hall-of-fame" element={<HallOfFame />} />
            <Route path="business/notifications" element={<Notifications />} />
            <Route path="business/crm" element={<TeamCRM />} />
            <Route path="business/stats" element={<BusinessStats />} />
            <Route path="admin/submitted-deals" element={<AdminRoute><AdminSubmittedDeals /></AdminRoute>} />
          </Route>
        </Routes>
      </HashRouter>
    </AuthProvider>
  );
}
