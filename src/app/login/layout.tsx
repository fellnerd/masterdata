import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Login - Master Data Services",
  description: "Anmeldung bei Master Data Services",
}

export default function LoginLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // Login page without sidebar
  return <>{children}</>
}
