import type {Metadata} from "next";
import {Space_Grotesk, Inter, IBM_Plex_Mono} from "next/font/google";
import "./globals.css";
import Nav from "../components/Nav";
import Footer from "../components/Footer";

const display = Space_Grotesk({subsets: ["latin"], weight: ["500", "600", "700"], variable: "--font-display"});
const body = Inter({subsets: ["latin"], variable: "--font-body"});
const mono = IBM_Plex_Mono({subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-mono"});

export const metadata: Metadata = {
  title: "Pact — conditional settlement for x402 agent payments",
  description: "Pay-on-delivery escrow, earned reputation, and an autonomous agent — live on Pharos.",
};

export default function RootLayout({children}: {children: React.ReactNode}) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${mono.variable}`}>
      <body>
        <div className="aurora" aria-hidden />
        <Nav />
        <main className="container">{children}</main>
        <Footer />
      </body>
    </html>
  );
}
