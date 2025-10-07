import { Suspense, lazy, useEffect } from "react";
import {
  BrowserRouter as Router,
  Routes,
  Route,
  Navigate,
} from "react-router-dom";
import JoinPage from "./pages/JoinPage";
import GroupsPage from "./pages/GroupsPage";
import ChatPage from "./pages/ChatPage";
import CreateRoomPage from "./pages/CreateRoomPage"; // NEW
import EditProfilePage from "./pages/EditProfilePage";
import ChatSettings from "./pages/ChatSettings";
import Toast from "./components/ui/Toast";
import { useAuthStore } from "./stores/authStore";
import { useSocketStore } from "./stores/socketStore";
import InboxPage from "./pages/InboxPage";
import PrivateChatPage from "./pages/PrivateChatPage";
import DatingPage from "./pages/DatingPage";
import DatingProfilePage from "./pages/DatingProfilePage";
import EditDatingProfile from "./pages/EditDatingProfile";
import AppShell from "./layout/AppShell"; // NEW
import DirectMessages from "./pages/DirectMessages"; // ensure this exists
import ActiveMembers from "./pages/ActiveMembers"; // NEW
import UserProfilePage from "./pages/UserProfilePage";
import ProfilePage from "./pages/ProfilePage";

const EmojiPickerPage = lazy(() => import("./pages/EmojiPickerPage"));
const GifPickerPage = lazy(() => import("./pages/GifPickerPage"));

function App() {
  const { joined, username } = useAuthStore();
  const { connect, disconnect } = useSocketStore();

  useEffect(() => {
    if (username) connect();
    else disconnect();
    return () => disconnect();
  }, [username, connect, disconnect]);

  return (
    <Router>
      <Suspense
        fallback={
          <div className="p-4 text-sm text-gray-500 select-none">
            Loading emoji picker…
          </div>
        }
      >
        <Routes>
          {/* Public entry */}
          <Route
            path="/"
            element={!joined ? <JoinPage /> : <Navigate to="/groups" replace />}
          />

          {/* Authenticated shell */}
          <Route element={joined ? <AppShell /> : <Navigate to="/" replace />}>
            <Route path="/groups" element={<GroupsPage />} />
            <Route path="/create-room" element={<CreateRoomPage />} />{" "}
            {/* NEW */}
            <Route path="/chat" element={<ChatPage />} />
            <Route path="/inbox" element={<InboxPage />} />
            <Route path="/direct" element={<DirectMessages />} /> {/* NEW */}
            <Route path="/dm/:peer" element={<PrivateChatPage />} />
            <Route path="/dating" element={<DatingPage />} />
            <Route path="/dating-profile" element={<DatingProfilePage />} />
            <Route
              path="/edit-dating-profile"
              element={<EditDatingProfile />}
            />
            <Route path="/edit-profile" element={<EditProfilePage />} />
            <Route path="/chat-settings" element={<ChatSettings />} />
            <Route path="/active-members" element={<ActiveMembers />} />
            <Route path="/u/:username" element={<UserProfilePage />} />
            <Route path="/profile" element={<ProfilePage />} />
            {/* Keep pickers inside shell; header/nav are handled by AppShell */}
            <Route path="/emoji-picker" element={<EmojiPickerPage />} />
            <Route path="/gif-picker" element={<GifPickerPage />} />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
      <Toast />
    </Router>
  );
}

export default App;
