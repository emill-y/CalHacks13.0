import { PrivacyActions } from "@/components/PrivacyActions";

export default function PrivacyPage() {
  return (
    <div className="max-w-3xl pt-10">
      <h1 className="font-display text-5xl font-semibold">Privacy</h1>
      <p className="mt-3 text-lg text-muted">ThisBut is built to need as little of you as possible.</p>
      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        {[
          ["Your photos", "Cropped and downscaled to 768 px in your browser, sent once for your search, held in memory, then discarded. Never written to disk, a database, or logs. You’ll see “Photo discarded ✓” after each search."],
          ["Wishes", "Saved as edit text only (e.g. “Blouse · remove bow” plus the parsed spec and an optional max price). No image, no name, no email."],
          ["Anonymous events", "Search / match / no-match / wish / order counts with the edit label, tied to a random device id stored in your browser. Used for demand statistics."],
          ["Merchants see", "Aggregates only. Live gaps with fewer than 3 shoppers are hidden. Seeded demo rows are always labeled “Demo data”."],
          ["Payments", "Test mode. The card number is checked in your browser and never stored or sent; the confirmation shows only the last 4 digits."],
          ["AI processing", "Your photo and edit are sent to the Anthropic API to understand the edit and verify results. Text inside images is treated as product content, never as instructions."],
        ].map(([t, d]) => (
          <div key={t} className="rounded-3xl border border-line bg-card p-5">
            <h2 className="font-display text-xl font-semibold">{t}</h2>
            <p className="mt-1 text-sm text-muted">{d}</p>
          </div>
        ))}
      </div>
      <PrivacyActions />
    </div>
  );
}
