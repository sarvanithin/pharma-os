/**
 * Seeds realistic demo documents into an org by running the REAL ingestion pipeline
 * (parse -> chunk -> Voyage embeddings -> Claude classify/extract) against the
 * configured Supabase project. Run: tsx --env-file=.env.local scripts/seed-demo.ts <org-slug>
 */
import { createAdminClient } from "@/lib/supabase/admin";
import { runProcessing } from "@/server/processing/pipeline";

const SLUG = process.argv[2] || "helix-biotherapeutics-jjvhgz";

const DOCS: { name: string; text: string }[] = [
  {
    name: "ABC-123 Phase 2 CSR.txt",
    text: `CLINICAL STUDY REPORT

Study Title: A Randomized, Double-Blind, Placebo-Controlled Phase 2 Study of ABC-123 in Adults with Moderate-to-Severe Rheumatoid Arthritis
Study Phase: Phase 2
Indication: Moderate-to-severe rheumatoid arthritis

METHODS
A total of 240 subjects were randomized 1:1 to receive ABC-123 50 mg once daily or matching placebo for 24 weeks. The primary endpoint was the change from baseline in DAS28-CRP at Week 12.

RESULTS
The primary endpoint was met: ABC-123 demonstrated a statistically significant reduction in DAS28-CRP versus placebo (-2.4 vs -0.9; p<0.001). ACR20 response at Week 12 was 62% for ABC-123 versus 31% for placebo.

SAFETY
Treatment-emergent adverse events occurred in 48% of ABC-123 subjects and 45% of placebo subjects. The most common adverse events were headache and nausea. No new safety signals were observed. There were two serious adverse events in the ABC-123 arm, both resolved.

CONCLUSION
ABC-123 demonstrated a favorable benefit-risk profile in moderate-to-severe rheumatoid arthritis and supports advancement to Phase 3.`,
  },
  {
    name: "ABC-123 Composition Patent.txt",
    text: `UNITED STATES PATENT APPLICATION

Title: Substituted Pyrimidine Compounds as JAK1 Inhibitors and Methods of Use
Assignee: Helix Biotherapeutics, Inc.
Inventors: J. Chen; M. Okafor; L. Romano
Filing Date: 2024-03-14
Priority Date: 2023-03-15

ABSTRACT
Disclosed are substituted pyrimidine compounds, including ABC-123, that selectively inhibit Janus kinase 1 (JAK1), pharmaceutical compositions thereof, and methods of treating inflammatory and autoimmune disorders.

CLAIMS
1. A compound of Formula (I), or a pharmaceutically acceptable salt thereof, wherein the compound selectively inhibits JAK1 over JAK2 by at least 10-fold.
2. The compound of claim 1, wherein the compound is ABC-123.
3. A pharmaceutical composition comprising the compound of claim 1 and a pharmaceutically acceptable carrier.
4. A method of treating rheumatoid arthritis comprising administering a therapeutically effective amount of the compound of claim 1 to a patient in need thereof.`,
  },
  {
    name: "ABC-123 IND Summary.txt",
    text: `INVESTIGATIONAL NEW DRUG APPLICATION — SUMMARY

Sponsor: Helix Biotherapeutics, Inc.
Drug Name: ABC-123 (JAK1 inhibitor)
Indication: Moderate-to-severe rheumatoid arthritis
Phase: Phase 2
Route of Administration: Oral, once daily
Submission Date: 2024-01-30

PRIMARY OBJECTIVE
To evaluate the efficacy and safety of ABC-123 in adults with moderate-to-severe rheumatoid arthritis who have had an inadequate response to methotrexate.

NONCLINICAL SUMMARY
ABC-123 was evaluated in a comprehensive nonclinical program including 13-week GLP toxicology studies in rats and non-human primates. The no-observed-adverse-effect level supports the proposed clinical dosing.`,
  },
];

async function main() {
  const db = createAdminClient();
  const { data: org, error } = await db.from("organizations").select("id, name").eq("slug", SLUG).single();
  if (error || !org) throw new Error(`Org not found for slug ${SLUG}: ${error?.message}`);
  console.log(`Seeding into org ${org.name} (${org.id})`);

  // Idempotent: clear existing documents (cascades to chunks/pages/extractions).
  await db.from("documents").delete().eq("org_id", org.id);

  for (const d of DOCS) {
    const { data: doc } = await db
      .from("documents")
      .insert({
        org_id: org.id,
        title: d.name.replace(/\.[^.]+$/, ""),
        source_filename: d.name,
        mime_type: "text/plain",
        byte_size: d.text.length,
        status: "uploaded",
      })
      .select("id")
      .single();
    const path = `${org.id}/${doc!.id}/${d.name}`;
    await db.storage.from("documents").upload(path, new Blob([d.text], { type: "text/plain" }), {
      contentType: "text/plain",
      upsert: true,
    });
    await db.from("documents").update({ storage_path: path }).eq("id", doc!.id);

    process.stdout.write(`Processing ${d.name} ... `);
    await runProcessing(doc!.id, org.id);
    const { data: after } = await db
      .from("documents")
      .select("status, doc_type, doc_type_confidence")
      .eq("id", doc!.id)
      .single();
    const { count } = await db
      .from("chunks")
      .select("id", { count: "exact", head: true })
      .eq("document_id", doc!.id);
    console.log(`${after!.status} | type=${after!.doc_type} (${Math.round((after!.doc_type_confidence ?? 0) * 100)}%) | ${count} chunks`);
  }
  console.log("Done.");
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e);
  process.exit(1);
});
