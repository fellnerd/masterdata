import type { Metadata } from "next"
import "./globals.scss"
import { Providers } from "@/components/providers"

export const metadata: Metadata = {
  title: "Master Data Services",
  description: "Enterprise Master Data Management",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="de" suppressHydrationWarning>
      <body>
        <Providers>
          {children}
        </Providers>
      </body>
    </html>
  )
}
