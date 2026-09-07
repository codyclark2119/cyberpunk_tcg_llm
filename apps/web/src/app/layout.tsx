import type { Metadata } from "next";
import "./globals.css";
import { Nav } from "@/components/nav";
import { ApolloProvider } from "@/lib/apollo/provider";

export const metadata: Metadata = {
  title: "Cyberpunk TCG Online",
  description: "Community-built online play platform foundation for Cyberpunk Trading Card Game."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <ApolloProvider>
          <Nav />
          <main>{children}</main>
        </ApolloProvider>
      </body>
    </html>
  );
}
