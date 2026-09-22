import Link from "next/link";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";

const FEATURES = [
  {
    title: "SHA-256 Hash-Chaining",
    description:
      "Every journal entry and invoice write is cryptographically linked to the one before it, inline, inside the same database transaction.",
  },
  {
    title: "Merkle Checkpointing",
    description:
      "An independent signing service periodically batches the chain into a Merkle tree and signs the root with ECDSA — never the web app itself.",
  },
  {
    title: "Independent Verification",
    description:
      "Anyone can verify a record's inclusion in a signed checkpoint via a logarithmic-size Merkle proof, without trusting the application server.",
  },
  {
    title: "Role-Based Access Control",
    description:
      "Bookkeepers, accountants, and auditors get precisely scoped permissions, enforced by stateless JWT sessions.",
  },
  {
    title: "Live Financial Reporting",
    description: "Trial balance and income statement computed directly from posted journal entries, always current.",
  },
  {
    title: "Full Audit Trail",
    description: "Every ledger-affecting action is logged and cross-referenced to its hash-chain entry for review.",
  },
];

const STEPS = [
  {
    step: "1",
    title: "You post a transaction",
    description: "A journal entry or invoice is written to Postgres inside a single atomic transaction.",
  },
  {
    step: "2",
    title: "It's hash-chained instantly",
    description: "SHA-256 links the record to the previous one for your organisation — adds under 300ms.",
  },
  {
    step: "3",
    title: "The checkpoint service signs a batch",
    description: "An independent worker builds a Merkle tree over pending entries and signs the root with ECDSA.",
  },
  {
    step: "4",
    title: "Anyone can verify it",
    description: "The verification API reconstructs the Merkle proof and checks the signature — no private key required.",
  },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-white">
      <header className="border-b border-slate-200">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-white font-bold">
              SL
            </div>
            <span className="text-lg font-bold text-slate-900">SecureLedger</span>
          </div>
          <div className="flex items-center gap-3">
            <Link href="/login" className="text-sm font-bold text-slate-600 hover:text-primary">
              Log in
            </Link>
            <Link href="/register">
              <Button>Get started</Button>
            </Link>
          </div>
        </div>
      </header>

      <section className="mx-auto max-w-5xl px-6 py-24 text-center">
        <h1 className="text-4xl font-bold leading-tight text-slate-900 sm:text-5xl">
          Cloud accounting with a <span className="text-primary">tamper-evident</span> ledger
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg font-medium text-slate-600">
          SecureLedger hash-chains every transaction and independently checkpoints it with ECDSA-signed
          Merkle roots — so your books are provably intact, not just backed up.
        </p>
        <div className="mt-10 flex items-center justify-center gap-4">
          <Link href="/register">
            <Button className="px-6 py-3 text-base">Create free account</Button>
          </Link>
          <Link href="/login">
            <Button variant="secondary" className="px-6 py-3 text-base">
              Log in
            </Button>
          </Link>
        </div>
      </section>

      <section className="border-y border-slate-200 bg-slate-50 py-6">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-center gap-x-10 gap-y-3 px-6 text-sm font-bold text-slate-500">
          <span>AES-256 encryption at rest</span>
          <span className="text-slate-300">•</span>
          <span>TLS in transit</span>
          <span className="text-slate-300">•</span>
          <span>Stateless JWT authentication</span>
          <span className="text-slate-300">•</span>
          <span>ECDSA-signed checkpoints</span>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-6 py-24">
        <h2 className="text-center text-3xl font-bold text-slate-900">Built for provable integrity</h2>
        <div className="mt-12 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <Card key={f.title}>
              <h3 className="font-bold text-slate-900">{f.title}</h3>
              <p className="mt-2 text-sm font-medium text-slate-600">{f.description}</p>
            </Card>
          ))}
        </div>
      </section>

      <section className="bg-slate-50 py-24">
        <div className="mx-auto max-w-6xl px-6">
          <h2 className="text-center text-3xl font-bold text-slate-900">How it works</h2>
          <div className="mt-12 grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((s) => (
              <div key={s.step} className="text-center">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary text-lg font-bold text-white">
                  {s.step}
                </div>
                <h3 className="mt-4 font-bold text-slate-900">{s.title}</h3>
                <p className="mt-2 text-sm font-medium text-slate-600">{s.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-4xl px-6 py-24 text-center">
        <h2 className="text-3xl font-bold text-slate-900">Ready to close the books with confidence?</h2>
        <p className="mt-4 text-base font-medium text-slate-600">
          Set up your organisation in under a minute.
        </p>
        <div className="mt-8">
          <Link href="/register">
            <Button className="px-6 py-3 text-base">Create free account</Button>
          </Link>
        </div>
      </section>

      <footer className="border-t border-slate-200 py-10">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-4 px-6 text-sm text-slate-500 sm:flex-row">
          <span>© {new Date().getFullYear()} SecureLedger. All rights reserved.</span>
          <span>Hash-chained on PostgreSQL. Checkpointed independently. Verified in the open.</span>
        </div>
      </footer>
    </div>
  );
}
