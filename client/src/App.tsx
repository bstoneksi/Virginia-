import { BrowserRouter, Route, Routes } from "react-router";
import { AppShell } from "@/components/AppShell";
import { BootstrapProvider } from "@/lib/bootstrap";
import { ConfirmProvider } from "@/lib/confirm";
import { ItemDrawerProvider } from "@/lib/drawer";
import { PendingCapturesProvider, TitleProvider } from "@/lib/shell";
import { ToastProvider } from "@/lib/toast";
import { AgendaPage } from "@/pages/AgendaPage";
import { BoardPage } from "@/pages/BoardPage";
import { BrandPage } from "@/pages/BrandPage";
import { BrandsPage } from "@/pages/BrandsPage";
import { BriefsPage } from "@/pages/BriefsPage";
import { CapturePage } from "@/pages/CapturePage";
import { LoginPage } from "@/pages/LoginPage";
import { MorePage } from "@/pages/MorePage";
import { NotFoundPage } from "@/pages/NotFoundPage";
import { PeoplePage } from "@/pages/PeoplePage";
import { PersonalPage } from "@/pages/PersonalPage";
import { ReviewPage } from "@/pages/ReviewPage";
import { SearchPage } from "@/pages/SearchPage";
import { SettingsPage } from "@/pages/SettingsPage";
import { TodayPage } from "@/pages/TodayPage";

/** Everything behind the login: reference data, shell contexts, the shared item drawer and the layout. */
function AuthedLayout() {
  return (
    <BootstrapProvider>
      <TitleProvider>
        <PendingCapturesProvider>
          <ItemDrawerProvider>
            <AppShell />
          </ItemDrawerProvider>
        </PendingCapturesProvider>
      </TitleProvider>
    </BootstrapProvider>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <ConfirmProvider>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route element={<AuthedLayout />}>
              <Route index element={<TodayPage />} />
              <Route path="board" element={<BoardPage />} />
              <Route path="people" element={<PeoplePage />} />
              <Route path="people/:initials" element={<AgendaPage />} />
              <Route path="brands" element={<BrandsPage />} />
              <Route path="brands/:code" element={<BrandPage />} />
              <Route path="personal" element={<PersonalPage />} />
              <Route path="capture" element={<CapturePage />} />
              <Route path="capture/:id" element={<ReviewPage />} />
              <Route path="search" element={<SearchPage />} />
              <Route path="briefs" element={<BriefsPage />} />
              <Route path="settings" element={<SettingsPage />} />
              <Route path="more" element={<MorePage />} />
              <Route path="*" element={<NotFoundPage />} />
            </Route>
          </Routes>
        </ConfirmProvider>
      </ToastProvider>
    </BrowserRouter>
  );
}
