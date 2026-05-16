import { lazy, Suspense } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { installToastSounds } from "@/lib/toastSound";

// Attach success/error/info/warning sound effects to every sonner toast.
installToastSounds();

// Pull GTO custom ranges from DB + listen realtime updates
import { initRemoteRanges } from "@/lib/gto/precomputed";
initRemoteRanges();
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/hooks/useAuth";
import { Layout } from "@/components/Layout";
import { UpdateNotifier } from "@/components/UpdateNotifier";
import { UpdateOverlay } from "@/components/UpdateOverlay";
import { PushNotificationPrompt } from "@/components/PushNotificationPrompt";
import { EmailVerificationGate } from "@/components/EmailVerificationGate";
import { LanguagePrompt } from "@/components/LanguagePrompt";
import { RouteLoader } from "@/components/RouteLoader";

const Tournaments = lazy(() => import("./pages/Tournaments"));
const TournamentDetail = lazy(() => import("./pages/TournamentDetail"));
const Clubs = lazy(() => import("./pages/Clubs"));
const ClubDetail = lazy(() => import("./pages/ClubDetail"));
const MyStacks = lazy(() => import("./pages/MyStacks"));
const Account = lazy(() => import("./pages/Account"));
const Auth = lazy(() => import("./pages/Auth"));
const ClubAdmin = lazy(() => import("./pages/ClubAdmin"));
const SuperAdmin = lazy(() => import("./pages/SuperAdmin"));
const CashierDashboard = lazy(() => import("./pages/CashierDashboard"));
const MediaCenter = lazy(() => import("./pages/MediaCenter"));
const AdminUsers = lazy(() => import("./pages/AdminUsers"));
const AdminLeaderboard = lazy(() => import("./pages/AdminLeaderboard"));
const AdminMoneyList = lazy(() => import("./pages/AdminMoneyList"));
const AdminWebVitals = lazy(() => import("./pages/AdminWebVitals"));
const BulkCreateTournaments = lazy(() => import("./pages/BulkCreateTournaments"));
const Leaderboard = lazy(() => import("./pages/Leaderboard"));
const Documents = lazy(() => import("./pages/Documents"));
const Video = lazy(() => import("./pages/Video"));
const BookingChat = lazy(() => import("./pages/BookingChat"));
const ChatInbox = lazy(() => import("./pages/ChatInbox"));
const DirectChat = lazy(() => import("./pages/DirectChat"));
const GroupChat = lazy(() => import("./pages/GroupChat"));
const GroupInvite = lazy(() => import("./pages/GroupInvite"));
const SeriesDetail = lazy(() => import("./pages/SeriesDetail"));
const SetupDavinci = lazy(() => import("./pages/SetupDavinci"));
const FindBacker = lazy(() => import("./pages/FindBacker"));
const PlayerProfile = lazy(() => import("./pages/PlayerProfile"));
const Marketplace = lazy(() => import("./pages/Marketplace"));
const StakingNew = lazy(() => import("./pages/StakingNew"));
const StakingMyDeals = lazy(() => import("./pages/StakingMyDeals"));
const StakingPortfolio = lazy(() => import("./pages/StakingPortfolio"));
const AdminStaking = lazy(() => import("./pages/AdminStaking"));
const Notifications = lazy(() => import("./pages/Notifications"));
const News = lazy(() => import("./pages/News"));
const NewsDetail = lazy(() => import("./pages/NewsDetail"));
const InternationalEvents = lazy(() => import("./pages/InternationalEvents"));
const Terms = lazy(() => import("./pages/Terms"));
const Privacy = lazy(() => import("./pages/Privacy"));
const VerifyEmail = lazy(() => import("./pages/VerifyEmail"));
const ForgotPassword = lazy(() => import("./pages/ForgotPassword"));
const ResetPassword = lazy(() => import("./pages/ResetPassword"));
const NotFound = lazy(() => import("./pages/NotFound.tsx"));
const RangeEditor = lazy(() => import("./components/RangeEditor"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      gcTime: 30 * 60 * 1000,
      retry: 2,
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
      refetchOnWindowFocus: true,
    },
  },
});

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Sonner
        theme="dark"
        position="top-center"
        offset={`calc(env(safe-area-inset-top) + 16px)`}
        mobileOffset={{
          top: `calc(env(safe-area-inset-top) + 12px)`,
          bottom: `calc(env(safe-area-inset-bottom) + 96px)`,
          left: `calc(env(safe-area-inset-left) + 12px)`,
          right: `calc(env(safe-area-inset-right) + 12px)`,
        }}
      />
      <BrowserRouter>
        <AuthProvider>
          <UpdateNotifier />
          <UpdateOverlay />
          {/* UpdateBanner disabled — auto-update silently khi user ẩn tab/idle */}
          {/* <UpdateBanner /> */}
          <EmailVerificationGate />
          <LanguagePrompt />
          <PushNotificationPrompt />
          <Suspense fallback={<RouteLoader />}>
            <Routes>
              <Route path="/auth" element={<Auth />} />
              <Route path="/verify-email" element={<VerifyEmail />} />
              <Route path="/forgot-password" element={<ForgotPassword />} />
              <Route path="/reset-password" element={<ResetPassword />} />
              <Route path="/terms" element={<Terms />} />
              <Route path="/privacy" element={<Privacy />} />
              <Route path="/setup-davinci" element={<SetupDavinci />} />
              <Route element={<Layout />}>
                <Route path="/" element={<Tournaments />} />
                <Route path="/tournament/:id" element={<TournamentDetail />} />
                <Route path="/clubs" element={<Clubs />} />
                <Route path="/club/:id" element={<ClubDetail />} />
                <Route path="/my-stacks" element={<MyStacks />} />
                <Route path="/leaderboard" element={<Leaderboard />} />
                <Route path="/documents" element={<Documents />} />
                <Route path="/video" element={<Video />} />
                <Route path="/chat/:tournamentId" element={<BookingChat />} />
                <Route path="/inbox" element={<ChatInbox />} />
                <Route path="/dm/:userId" element={<DirectChat />} />
                <Route path="/group/:groupId" element={<GroupChat />} />
                <Route path="/invite/:token" element={<GroupInvite />} />
                <Route path="/series/:id" element={<SeriesDetail />} />
                <Route path="/account" element={<Account />} />
                <Route path="/find-backer" element={<FindBacker />} />
                <Route path="/marketplace" element={<Marketplace />} />
                <Route path="/staking/new" element={<StakingNew />} />
                <Route path="/staking/my-deals" element={<StakingMyDeals />} />
                <Route path="/staking/portfolio" element={<StakingPortfolio />} />
                <Route path="/admin/staking" element={<AdminStaking />} />
                <Route path="/notifications" element={<Notifications />} />
                <Route path="/news" element={<News />} />
                <Route path="/news/:slug" element={<NewsDetail />} />
                <Route path="/international" element={<InternationalEvents />} />
                <Route path="/player/:userId" element={<PlayerProfile />} />
                <Route path="/club/admin" element={<ClubAdmin />} />
                <Route path="/cashier" element={<CashierDashboard />} />
                <Route path="/admin" element={<SuperAdmin />} />
                <Route path="/admin/users" element={<AdminUsers />} />
                <Route path="/media" element={<MediaCenter />} />
                <Route path="/admin/tournaments/bulk-create" element={<BulkCreateTournaments />} />
                <Route path="/admin/leaderboard" element={<AdminLeaderboard />} />
                <Route path="/admin/money-list" element={<AdminMoneyList />} />
                <Route path="/admin/web-vitals" element={<AdminWebVitals />} />
                <Route path="/admin/gto-ranges" element={<div className="container mx-auto p-4"><RangeEditor /></div>} />
                <Route path="*" element={<NotFound />} />
              </Route>
            </Routes>
          </Suspense>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
