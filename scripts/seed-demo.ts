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
  {
    name: "ABC-456 中国专利摘要.txt",
    text: `中华人民共和国发明专利申请

发明名称: 一类取代嘧啶类化合物作为JAK1选择性抑制剂及其医药用途
申请人: 螺旋生物制药有限公司
发明人: 陈建华; 王思源; 罗芳

摘要
本发明涉及一类新型取代嘧啶类化合物 (代号 ABC-456) 及其药学上可接受的盐, 包含该化合物的药物组合物, 以及该化合物在制备治疗炎症性和自身免疫性疾病药物中的用途。

权利要求
1. 一种式 (I) 所示化合物或其药学上可接受的盐, 其中所述化合物对 JAK1 的选择性抑制活性比 JAK2 高至少 10 倍。
2. 根据权利要求 1 所述的化合物, 其特征在于该化合物为 ABC-456。
3. 一种药物组合物, 包含权利要求 1 所述的化合物和药学上可接受的载体。
4. 一种治疗类风湿关节炎的方法, 包括向需要治疗的患者施用治疗有效量的权利要求 1 所述的化合物。`,
  },
  {
    name: "Résumé réglementaire ABC-789.txt",
    text: `RÉSUMÉ RÉGLEMENTAIRE — ABC-789

Promoteur: Helix Biotherapeutics, S.A.
Nom du médicament: ABC-789 (inhibiteur sélectif de JAK1)
Indication: Polyarthrite rhumatoïde modérée à sévère
Phase: Phase 1b
Voie d'administration: Orale, une fois par jour
Date de soumission: 2024-09-12

OBJECTIF PRINCIPAL
Évaluer la sécurité, la tolérance et la pharmacocinétique de doses ascendantes uniques et multiples d'ABC-789 chez des adultes atteints de polyarthrite rhumatoïde.

RÉSUMÉ NON CLINIQUE
ABC-789 a été évalué dans un programme non clinique complet incluant des études GLP de toxicologie de 4 semaines chez le rat et le chien. Aucun signal de toxicité critique n'a été observé à la dose proposée.

PROFIL DE SÉCURITÉ ATTENDU
Les principales préoccupations de sécurité incluent le risque d'infections opportunistes et la surveillance hématologique de routine.`,
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
    // Supabase storage keys must be ASCII; the original filename is preserved on the row.
    const ext = d.name.match(/\.[^.]+$/)?.[0] ?? ".txt";
    const path = `${org.id}/${doc!.id}/source${ext}`;
    await db.storage.from("documents").upload(path, new Blob([d.text], { type: "text/plain" }), {
      contentType: "text/plain",
      upsert: true,
    });
    await db.from("documents").update({ storage_path: path }).eq("id", doc!.id);

    process.stdout.write(`Processing ${d.name} ... `);
    await runProcessing(doc!.id, org.id);
    const { data: after } = await db
      .from("documents")
      .select("status, doc_type, doc_type_confidence, language")
      .eq("id", doc!.id)
      .single();
    const { count } = await db
      .from("chunks")
      .select("id", { count: "exact", head: true })
      .eq("document_id", doc!.id);
    console.log(`${after!.status} | type=${after!.doc_type} (${Math.round((after!.doc_type_confidence ?? 0) * 100)}%) | lang=${after!.language ?? "?"} | ${count} chunks`);
  }
  console.log("Done.");
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e);
  process.exit(1);
});
