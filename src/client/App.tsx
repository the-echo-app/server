import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ReactNode } from "react"
import { BrowserRouter, Route, Routes } from "react-router-dom"
import { ErrorBoundary } from "./components/ErrorBoundary"
import { Header } from "./components/Header"
import { ToastProvider } from "./components/Toast"
import { AuthProvider } from "./contexts/AuthContext"
import { SocketProvider } from "./contexts/SocketContext"
import { HomePage } from "./pages/HomePage"

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5,
      gcTime: 1000 * 60 * 10,
      retry: 1,
    },
  },
})

function Providers({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

export function App() {
  return (
    <div className="flex flex-col w-full min-h-screen relative font-body bg-background text-foreground">
      <ErrorBoundary>
        <Providers>
          <AuthProvider>
            <SocketProvider>
              <ToastProvider>
                <BrowserRouter>
                  <Header className="fixed h-header" />
                  <main className="relative m-after-header">
                    <Routes>
                      <Route path="/" element={<HomePage />} />
                    </Routes>
                  </main>
                  <footer>
                    <p className="text-xs p-4">Echo</p>
                  </footer>
                </BrowserRouter>
              </ToastProvider>
            </SocketProvider>
          </AuthProvider>
        </Providers>
      </ErrorBoundary>
    </div>
  )
}
