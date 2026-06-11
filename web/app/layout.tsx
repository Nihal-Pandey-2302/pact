import type {Metadata} from "next";
import "./globals.css";
import Nav from "../components/Nav";

export const metadata: Metadata = {
  title: "Pact — conditional settlement for x402 agent payments",
  description: "Pay-on-delivery escrow, reputation, and an autonomous agent — on Pharos.",
};

export default function RootLayout({children}: {children: React.ReactNode}) {
  return (
    <html lang="en">
      <body>
        <Nav />
        <main className="container">{children}</main>
        <footer>
          Pact — the escrow scheme for x402 · built for the Pharos Skill-to-Agent hackathon
        </footer>
      </body>
    </html>
  );
}
