import { lazy, Suspense } from "react";
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
} from "react-router-dom";
import {
  ClerkProvider,
  SignIn,
  SignUp,
  useAuth,
} from "@clerk/react";
import { publishableKeyFromHost } from "@clerk/react/internal";
import { shadcn } from "@clerk/themes";
import { ConsoleLayout } from "./components/ConsoleLayout";
import { AppStoreProvider } from "./store/AppStore";
import AuthLanding from "./pages/AuthLanding";

const Overview = lazy(() => import("./pages/Overview"));
const Devices = lazy(() => import("./pages/Devices"));
const Sessions = lazy(() => import("./pages/Sessions"));
const Deployment = lazy(() => import("./pages/Deployment"));
const Automation = lazy(() => import("./pages/Automation"));
const RelayNetwork = lazy(() => import("./pages/RelayNetwork"));
const AuditLog = lazy(() => import("./pages/AuditLog"));
const Reports = lazy(() => import("./pages/Reports"));
const Settings = lazy(() => import("./pages/Settings"));

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");
const clerkPubKey = publishableKeyFromHost(
  window.location.hostname,
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
);
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;

if (!clerkPubKey) {
  throw new Error("Missing VITE_CLERK_PUBLISHABLE_KEY.");
}

const clerkAppearance = {
  theme: shadcn,
  cssLayerName: "clerk",
  options: {
    logoPlacement: "inside" as const,
    logoLinkUrl: basePath || "/",
    logoImageUrl: `${window.location.origin}${basePath}/logo.svg`,
  },
  variables: {
    colorPrimary: "#c1f451",
    colorForeground: "#ecf0e8",
    colorMutedForeground: "#9ba69c",
    colorDanger: "#f08070",
    colorBackground: "#131814",
    colorInput: "#1b211c",
    colorInputForeground: "#f3f6ef",
    colorNeutral: "#536052",
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
    borderRadius: "12px",
  },
  elements: {
    rootBox: "w-full flex justify-center",
    cardBox:
      "bg-[#111612] border border-lime-300/15 rounded-2xl w-[440px] max-w-full overflow-hidden",
    card: "!shadow-none !border-0 !bg-transparent !rounded-none",
    footer: "!shadow-none !border-0 !bg-transparent !rounded-none",
    headerTitle: "font-semibold tracking-tight text-slate-100",
    headerSubtitle: "text-slate-400",
    formFieldLabel: "text-slate-300",
    formFieldInput:
      "bg-[#1b211c] border-white/10 text-slate-100 placeholder:text-slate-500",
    formButtonPrimary:
      "bg-lime-300 text-slate-950 hover:bg-lime-200 font-semibold",
    footerActionLink: "text-lime-300 hover:text-lime-200",
    footerActionText: "text-slate-400",
  },
};

function PageLoader() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <div className="flex items-center gap-3 font-mono text-[10px] uppercase tracking-[0.16em] text-slate-600">
        <span className="h-4 w-4 animate-spin rounded-full border border-white/10 border-t-lime-300" />
        Loading workspace
      </div>
    </div>
  );
}

function SignInPage() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-[#0d110e] px-4 py-10">
      <SignIn
        routing="path"
        path={`${basePath}/sign-in`}
        signUpUrl={`${basePath}/sign-up`}
      />
    </div>
  );
}

function SignUpPage() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-[#0d110e] px-4 py-10">
      <SignUp
        routing="path"
        path={`${basePath}/sign-up`}
        signInUrl={`${basePath}/sign-in`}
      />
    </div>
  );
}

function SignedInConsole() {
  const { isLoaded, isSignedIn, userId } = useAuth();
  if (!isLoaded) return <PageLoader />;
  if (!isSignedIn || !userId) return <AuthLanding />;

  return (
    <AppStoreProvider key={userId} userId={userId}>
      <Suspense fallback={<PageLoader />}>
        <Routes>
          <Route element={<ConsoleLayout />}>
            <Route index element={<Overview />} />
            <Route path="devices" element={<Devices />} />
            <Route path="devices/:deviceId" element={<Devices />} />
            <Route path="sessions" element={<Sessions />} />
            <Route path="deployment" element={<Deployment />} />
            <Route path="automation" element={<Automation />} />
            <Route path="relay" element={<RelayNetwork />} />
            <Route path="audit" element={<AuditLog />} />
            <Route path="reports" element={<Reports />} />
            <Route path="settings" element={<Settings />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </Suspense>
    </AppStoreProvider>
  );
}

function AppRoutes() {
  return (
    <Suspense fallback={<PageLoader />}>
      <Routes>
        <Route path="/sign-in/*" element={<SignInPage />} />
        <Route path="/sign-up/*" element={<SignUpPage />} />
        <Route path="/*" element={<SignedInConsole />} />
      </Routes>
    </Suspense>
  );
}

export default function App() {
  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      proxyUrl={clerkProxyUrl}
      appearance={clerkAppearance}
      signInUrl={`${basePath}/sign-in`}
      signUpUrl={`${basePath}/sign-up`}
      localization={{
        signIn: {
          start: {
            title: "Welcome back",
            subtitle: "Sign in to manage your devices",
          },
        },
        signUp: {
          start: {
            title: "Create your Agon account",
            subtitle: "Your devices stay isolated to your account",
          },
        },
      }}
    >
      <BrowserRouter basename={basePath}>
        <AppRoutes />
      </BrowserRouter>
    </ClerkProvider>
  );
}
